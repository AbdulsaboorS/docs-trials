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

const tracked = new Set<ChildProcess>();
let handlersInstalled = false;

/**
 * Tracks a child so an interrupt cannot leave a preview server holding the
 * port. A detached child is in its own process group, so Ctrl-C reaches this
 * process only.
 */
export function trackChild(child: ChildProcess): void {
  tracked.add(child);
  child.once("close", () => tracked.delete(child));
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      void Promise.all([...tracked].map(terminateProcessTree)).finally(() => {
        process.exit(130);
      });
    });
  }
}
