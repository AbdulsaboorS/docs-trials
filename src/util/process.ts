import { spawn, type ChildProcess } from "node:child_process";

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
export async function terminateProcessTree(child: ChildProcess): Promise<boolean> {
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

  const groupId = child.pid;
  const groupExists = () => {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch {
      return false;
    }
  };
  const send = (signal: NodeJS.Signals) => {
    try {
      process.kill(-groupId, signal);
    } catch {
      // The group may exit between the check and the signal.
    }
  };

  if (!groupExists()) return true;
  send("SIGTERM");
  for (let attempt = 0; attempt < 20 && groupExists(); attempt += 1) await delay(100);
  if (!groupExists()) return true;
  send("SIGKILL");
  for (let attempt = 0; attempt < 10 && groupExists(); attempt += 1) await delay(100);
  return !groupExists();
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
export function trackChild(child: ChildProcess): void {
  const untrack = trackInterruptCleanup(async () => {
    await terminateProcessTree(child);
  }, "children");
  child.once("close", untrack);
}
