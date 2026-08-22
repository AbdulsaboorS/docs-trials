import { execFile, spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "process",
);
const repeatedInterruptFixture = resolve(fixtureDirectory, "repeated-interrupt.ts");
const chromiumInterruptFixture = resolve(fixtureDirectory, "chromium-interrupt.ts");
const execFileAsync = promisify(execFile);

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForLine(
  child: ChildProcess,
  expected: string,
  stderr: () => string,
): Promise<void> {
  await new Promise<void>((resolveLine, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Fixture did not report ${expected}. stderr: ${stderr()}`)),
      10_000,
    );
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (!output.split("\n").includes(expected)) return;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdout?.off("data", onData);
      resolveLine();
    };
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Fixture exited before ${expected}: code=${String(code)} signal=${String(signal)} stderr: ${stderr()}`,
        ),
      );
    };
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function descendantsOf(rootPid: number): Promise<number[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=", "-o", "ppid="]);
  const children = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parentPid = Number(parentText);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) continue;
    const siblings = children.get(parentPid) ?? [];
    siblings.push(pid);
    children.set(parentPid, siblings);
  }

  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined) continue;
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return descendants.sort((left, right) => left - right);
}

async function waitForStableDescendants(rootPid: number): Promise<number[]> {
  const deadline = Date.now() + 10_000;
  let previous = "";
  let stableSamples = 0;
  while (Date.now() < deadline) {
    const descendants = await descendantsOf(rootPid);
    const snapshot = descendants.join(",");
    stableSamples = descendants.length > 0 && snapshot === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return descendants;
    previous = snapshot;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Chromium descendants did not reach a stable PID snapshot.");
}

async function waitForExit(
  child: ChildProcess,
  stderr: () => string,
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Fixture did not exit after SIGINT. stderr: ${stderr()}`)),
      10_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function waitForProcessesToExit(pids: number[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processExists(pid))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const remaining = pids.filter(processExists);
  throw new Error(`Chromium descendants remained after interrupt: ${remaining.join(", ")}`);
}

describe.skipIf(process.platform === "win32")("interrupt cleanup", () => {
  it("kills a detached SIGTERM-ignoring child after two quick SIGINTs", async () => {
    const parent = spawn(process.execPath, ["--import", "tsx", repeatedInterruptFixture], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childPid: number | undefined;

    try {
      childPid = await new Promise<number>((resolvePid, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Fixture did not report its child PID.")),
          5_000,
        );
        parent.once("error", reject);
        parent.once("exit", (code, signal) => {
          reject(
            new Error(
              `Fixture exited before it was ready: code=${String(code)} signal=${String(signal)}`,
            ),
          );
        });
        parent.stdout?.once("data", (chunk: Buffer) => {
          clearTimeout(timer);
          resolvePid(Number.parseInt(chunk.toString("utf8"), 10));
        });
      });

      process.kill(parent.pid!, "SIGINT");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      process.kill(parent.pid!, "SIGINT");

      const exitCode = await new Promise<number | null>((resolveExit, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Fixture did not finish cleanup.")),
          10_000,
        );
        parent.once("exit", (code) => {
          clearTimeout(timer);
          resolveExit(code);
        });
      });

      expect(exitCode).toBe(130);
      expect(processExists(childPid)).toBe(false);
    } finally {
      if (parent.pid && processExists(parent.pid)) process.kill(parent.pid, "SIGKILL");
      if (childPid && processExists(childPid)) process.kill(-childPid, "SIGKILL");
    }
  }, 15_000);

  it("does not leave tracked or Chromium descendants after SIGINT", async () => {
    const parent = spawn(process.execPath, ["--import", "tsx", chromiumInterruptFixture], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let chromiumPids: number[] = [];
    parent.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    try {
      await waitForLine(parent, "READY", () => stderr);
      chromiumPids = await waitForStableDescendants(parent.pid!);
      const exited = waitForExit(parent, () => stderr);

      process.kill(parent.pid!, "SIGINT");
      const status = await exited;

      expect(status.code === 130 || status.signal === "SIGINT", stderr).toBe(true);
      await waitForProcessesToExit(chromiumPids);
    } finally {
      if (parent.pid && processExists(parent.pid)) process.kill(parent.pid, "SIGKILL");
      for (const pid of chromiumPids.reverse()) {
        if (processExists(pid)) process.kill(pid, "SIGKILL");
      }
    }
  }, 25_000);
});
