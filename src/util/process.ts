import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const processListArgs = ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid="];

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Terminates a detached child and every descendant it started.
 *
 * Cleanup never throws. An earlier version threw from a `finally` block when a
 * process outlived a 100 ms grace period, which discarded the completed run
 * and every piece of evidence with it. The caller receives a boolean instead.
 */
export async function terminateProcessTree(
  child: ChildProcess,
  descendantGroups: ReadonlySet<number> = new Set(),
  interrupting = false,
): Promise<boolean> {
  if (!child.pid) return true;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      cleanup.once("error", () => resolve());
      cleanup.once("close", () => resolve());
    });
    return true;
  }

  const groups = new Set([child.pid, ...descendantGroups]);
  const groupExists = (groupId: number) => {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch {
      return false;
    }
  };
  const send = (signal: NodeJS.Signals) => {
    for (const groupId of groups) {
      try {
        process.kill(-groupId, signal);
      } catch {
        // A group may exit between the check and the signal.
      }
    }
  };
  const anyGroupExists = () => [...groups].some(groupExists);

  // Other signal handlers may exit the process at the first async boundary.
  const descendants = interrupting
    ? processGroupDescendantsSync(child.pid)
    : await processGroupDescendants(child.pid);
  for (const group of descendants?.values() ?? []) groups.add(group);

  if (!anyGroupExists()) return true;
  send("SIGTERM");
  for (let attempt = 0; attempt < 20 && anyGroupExists(); attempt += 1) await delay(100);
  if (!anyGroupExists()) return true;
  send("SIGKILL");
  for (let attempt = 0; attempt < 10 && anyGroupExists(); attempt += 1) await delay(100);
  return !anyGroupExists();
}

export async function processGroupDescendants(
  processGroupId: number,
): Promise<Map<number, number> | undefined> {
  try {
    const { stdout } = await runFile("ps", processListArgs, {
      maxBuffer: 2_000_000,
    });
    return parseProcessGroupDescendants(stdout, processGroupId);
  } catch {
    return undefined;
  }
}

function processGroupDescendantsSync(processGroupId: number): Map<number, number> | undefined {
  try {
    const stdout = execFileSync("ps", processListArgs, {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    return parseProcessGroupDescendants(stdout, processGroupId);
  } catch {
    return undefined;
  }
}

function parseProcessGroupDescendants(stdout: string, processGroupId: number): Map<number, number> {
  const processes: Array<{ pid: number; parent: number; group: number }> = [];
  const descendants = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText, groupText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parent = Number(parentText);
    const group = Number(groupText);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(parent) ||
      !Number.isSafeInteger(group)
    ) {
      continue;
    }
    processes.push({ pid, parent, group });
    if (group === processGroupId) descendants.set(pid, group);
  }
  // A package manager can start a child in a new group. Its ancestry still ties it to this launch.
  for (let size = -1; size !== descendants.size;) {
    size = descendants.size;
    for (const process of processes) {
      if (descendants.has(process.parent)) descendants.set(process.pid, process.group);
    }
  }
  return descendants;
}

type InterruptSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
type CleanupPhase = "children" | "state" | "owner";

const cleanupOrder: CleanupPhase[] = ["children", "state", "owner"];
const interruptCleanups = new Map<() => Promise<void>, CleanupPhase>();
let handlersInstalled = false;
let interruptCleanup: Promise<void> | undefined;

export function interruptWasRequested(): boolean {
  return interruptCleanup !== undefined;
}

function handleInterrupt(signal: InterruptSignal): void {
  if (interruptCleanup) return;
  interruptCleanup = (async () => {
    for (const phase of cleanupOrder) {
      for (;;) {
        const cleanups = [...interruptCleanups].filter((entry) => entry[1] === phase);
        if (cleanups.length === 0) break;
        for (const [cleanup] of cleanups) interruptCleanups.delete(cleanup);
        await Promise.allSettled(cleanups.map(([cleanup]) => cleanup()));
      }
    }
    process.exit({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal]);
  })();
}

/** Registers state that must be released before an interrupt exits the CLI. */
export function trackInterruptCleanup(
  cleanup: () => Promise<void>,
  phase: CleanupPhase = "state",
): () => void {
  interruptCleanups.set(cleanup, phase);
  if (!handlersInstalled) {
    handlersInstalled = true;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, () => handleInterrupt(signal));
    }
  }
  return () => {
    interruptCleanups.delete(cleanup);
  };
}

/** Tracks a detached child so an interrupt cannot leave its process group alive. */
export function trackChild(
  child: ChildProcess,
  descendantGroups: ReadonlySet<number> = new Set(),
  retainAfterClose = false,
): () => void {
  const untrack = trackInterruptCleanup(async () => {
    await terminateProcessTree(child, descendantGroups, true);
  }, "children");
  if (!retainAfterClose) child.once("close", untrack);
  return untrack;
}
