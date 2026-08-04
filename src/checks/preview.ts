import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { redact } from "../core/redact";
import { delay, terminateProcessTree, trackChild } from "../util/process";

const maxOutputBytes = 200_000;

export type Preview =
  | { available: true; status: number; url: string; output: string; stop: () => Promise<void> }
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
  const occupied = await probe(url);
  if (occupied.reachable) {
    const port = new URL(url).port || "80";
    const detail =
      `${url} already answered before the start command ran, so Docs Trials cannot tell whose server replied. ` +
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
  const stop = async () => {
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
      return {
        available: false,
        reason: "application",
        detail: `The start command exited with code ${child.exitCode ?? child.signalCode} before ${url} answered.`,
        output: output(),
        stop,
      };
    }
    const attempt = await probe(url);
    if (attempt.reachable) {
      return { available: true, status: attempt.status, url, output: output(), stop };
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
