import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { redact } from "../core/redact";
import { delay, terminateProcessTree, trackChild } from "../util/process";

const maxOutputBytes = 200_000;
const runFile = promisify(execFile);

export type Preview =
  | {
      available: true;
      status: number;
      url: string;
      output: string;
      confirmOwnership: () => Promise<boolean>;
      stop: () => Promise<void>;
    }
  | {
      available: false;
      reason: "application" | "infrastructure";
      detail: string;
      output: string;
      stop: () => Promise<void>;
    };

/**
 * Starts the application and waits until it answers an HTTP request.
 *
 * A port that never opens or a process that exits is an application failure.
 * A port already held by something else is an infrastructure failure, because
 * Docs Trials cannot tell whose server answered.
 */
export async function startPreview(
  command: string,
  workspace: string,
  url: string,
  timeoutSeconds: number,
): Promise<Preview> {
  const noop = async () => {};
  const occupied = await portInUse(url);
  if (occupied) {
    const port = new URL(url).port || "80";
    const detail =
      `Port ${port} already accepted a TCP connection before the start command ran, so Docs Trials cannot tell which process owns it. ` +
      `Stop the process holding port ${port} (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`), or point \`run.url\` and \`run.start\` at a free port.`;
    return { available: false, reason: "infrastructure", detail, output: detail, stop: noop };
  }

  let child: ChildProcess;
  try {
    child = spawn(command, {
      cwd: resolve(workspace),
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
  } catch (error) {
    const detail = `The start command could not launch: ${error instanceof Error ? error.message : String(error)}`;
    return { available: false, reason: "infrastructure", detail, output: detail, stop: noop };
  }
  trackChild(child);

  const chunks: Buffer[] = [];
  let bytes = 0;
  const append = (chunk: Buffer) => {
    const remaining = maxOutputBytes - bytes;
    if (remaining <= 0) return;
    const bounded = chunk.subarray(0, remaining);
    chunks.push(bounded);
    bytes += bounded.byteLength;
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const output = () => redact(`$ ${command}\n${Buffer.concat(chunks).toString("utf8")}`);
  let ownershipTimer: NodeJS.Timeout | undefined;
  const stop = async () => {
    if (ownershipTimer) clearInterval(ownershipTimer);
    await terminateProcessTree(child);
  };

  let launchError: Error | undefined;
  child.once("error", (error) => {
    launchError = error;
  });

  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (launchError) {
      return {
        available: false,
        reason: "infrastructure",
        detail: `The start command could not launch: ${launchError.message}`,
        output: output(),
        stop,
      };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      const unavailable = child.exitCode === 127;
      return {
        available: false,
        reason: unavailable ? "infrastructure" : "application",
        detail: unavailable
          ? `The start command exited with code 127 before ${url} answered. Docs Trials cannot distinguish unavailable host tooling from an intentional exit.`
          : `The start command exited with code ${child.exitCode ?? child.signalCode} before ${url} answered.`,
        output: output(),
        stop,
      };
    }
    const attempt = await probe(url);
    if (attempt.reachable) {
      const ownership = await listenerOwnership(url, child.pid);
      if (ownership.status !== "owned" || !ownership.owners) {
        const detail =
          ownership.status === "foreign"
            ? `${url} answered, but its listener does not belong to the start command's process group.`
            : `${url} answered, but Docs Trials could not establish which process owns its listener.`;
        return { available: false, reason: "infrastructure", detail, output: output(), stop };
      }
      const expectedOwners = ownership.owners;
      let ownershipStable = true;
      let ownershipCheck: Promise<void> | undefined;
      const checkOwnership = async () => {
        if (ownershipCheck) return ownershipCheck;
        ownershipCheck = (async () => {
          const owners = await listenerOwners(new URL(url));
          if (!owners || !sameNumbers(owners, expectedOwners)) ownershipStable = false;
        })().finally(() => {
          ownershipCheck = undefined;
        });
        return ownershipCheck;
      };
      ownershipTimer = setInterval(() => void checkOwnership(), 100);
      ownershipTimer.unref();
      return {
        available: true,
        status: attempt.status,
        url,
        output: output(),
        confirmOwnership: async () => {
          await checkOwnership();
          return ownershipStable;
        },
        stop,
      };
    }
    await delay(250);
  }

  return {
    available: false,
    reason: "application",
    detail: `${url} did not answer within ${timeoutSeconds} seconds.`,
    output: output(),
    stop,
  };
}

async function listenerOwnership(
  value: string,
  processGroupId: number | undefined,
): Promise<{ status: "owned" | "foreign" | "unknown"; owners?: Set<number> }> {
  if (!processGroupId || process.platform === "win32") return { status: "unknown" };
  const groupPids = await processGroupMembers(processGroupId);
  if (!groupPids) return { status: "unknown" };
  const owners = await listenerOwners(new URL(value));
  if (!owners || owners.size === 0) return { status: "unknown" };
  return [...owners].every((pid) => groupPids.has(pid))
    ? { status: "owned", owners }
    : { status: "foreign", owners };
}

async function listenerOwners(url: URL): Promise<Set<number> | undefined> {
  const port = Number(url.port || "80");
  return process.platform === "linux" ? linuxListenerOwners(port) : lsofListenerOwners(port);
}

async function processGroupMembers(processGroupId: number): Promise<Set<number> | undefined> {
  try {
    const { stdout } = await runFile("ps", ["-A", "-o", "pid=", "-o", "pgid="], {
      maxBuffer: 2_000_000,
    });
    const members = new Set<number>();
    for (const line of stdout.split("\n")) {
      const [pidText, groupText] = line.trim().split(/\s+/);
      const pid = Number(pidText);
      const group = Number(groupText);
      if (Number.isSafeInteger(pid) && group === processGroupId) members.add(pid);
    }
    return members;
  } catch {
    return undefined;
  }
}

async function lsofListenerOwners(port: number): Promise<Set<number> | undefined> {
  try {
    const { stdout } = await runFile(
      "lsof",
      ["-nP", "-t", `-iTCP:${String(port)}`, "-sTCP:LISTEN"],
      { maxBuffer: 100_000 },
    );
    return numericLines(stdout);
  } catch {
    return undefined;
  }
}

async function linuxListenerOwners(port: number): Promise<Set<number> | undefined> {
  const portHex = port.toString(16).toUpperCase().padStart(4, "0");
  const tables = await Promise.allSettled([
    readFile("/proc/net/tcp", "utf8"),
    readFile("/proc/net/tcp6", "utf8"),
  ]);
  const inodes = new Set<string>();
  for (const table of tables) {
    if (table.status !== "fulfilled") continue;
    for (const line of table.value.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      const localAddress = fields[1];
      if (fields[3] !== "0A" || !localAddress?.endsWith(`:${portHex}`) || !fields[9]) continue;
      inodes.add(fields[9]);
    }
  }
  if (inodes.size === 0) return undefined;

  let processDirectories: string[];
  try {
    processDirectories = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
  } catch {
    return undefined;
  }
  const owners = new Set<number>();
  const foundInodes = new Set<string>();
  for (const processDirectory of processDirectories) {
    let descriptors: string[];
    try {
      descriptors = await readdir(`/proc/${processDirectory}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      let target: string;
      try {
        target = await readlink(`/proc/${processDirectory}/fd/${descriptor}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      const inode = match?.[1];
      if (!inode || !inodes.has(inode)) continue;
      owners.add(Number(processDirectory));
      foundInodes.add(inode);
    }
  }
  return foundInodes.size === inodes.size ? owners : undefined;
}

function numericLines(value: string): Set<number> {
  return new Set(
    value
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => Number(line.trim()))
      .filter(Number.isSafeInteger),
  );
}

function sameNumbers(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

async function portInUse(value: string): Promise<boolean> {
  const url = new URL(value);
  const port = Number(url.port || "80");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1_000, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

async function probe(url: string): Promise<{ reachable: boolean; status: number }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1_000),
      redirect: "manual",
      headers: { "user-agent": "docs-trials-probe" },
    });
    await response.body?.cancel();
    return { reachable: true, status: response.status };
  } catch {
    return { reachable: false, status: 0 };
  }
}
