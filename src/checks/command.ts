import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { redact } from "../core/redact";
import { delay, terminateProcessTree, trackChild } from "../util/process";

const maxOutputBytes = 1_000_000;

export type CommandOutcome = {
  ran: boolean;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  output: string;
  durationMs: number;
};

export function succeeded(command: CommandOutcome): boolean {
  return command.ran && command.exitCode === 0 && !command.timedOut;
}

export async function runCommand(
  command: string,
  workspace: string,
  timeoutSeconds: number,
): Promise<CommandOutcome> {
  const startedAt = Date.now();
  const child = spawn(command, {
    cwd: resolve(workspace),
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  trackChild(child);

  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  const append = (chunk: Buffer) => {
    const remaining = maxOutputBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const bounded = chunk.subarray(0, remaining);
    chunks.push(bounded);
    bytes += bounded.byteLength;
    if (bounded.byteLength < chunk.byteLength) truncated = true;
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const finished = await new Promise<{
    exitCode: number | null;
    error?: Error;
    timedOut: boolean;
  }>((settle) => {
    let done = false;
    const finish = (value: { exitCode: number | null; error?: Error; timedOut: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(value);
    };
    const timer = setTimeout(
      () => finish({ exitCode: null, timedOut: true }),
      timeoutSeconds * 1_000,
    );
    child.once("error", (error) => finish({ exitCode: null, error, timedOut: false }));
    child.once("close", (code) => finish({ exitCode: code, timedOut: false }));
  });

  await terminateProcessTree(child);
  await delay(50);

  const notes = [
    finished.timedOut ? `Command exceeded the ${timeoutSeconds} second limit.` : "",
    truncated ? `Output was truncated at ${maxOutputBytes} bytes.` : "",
    finished.error ? finished.error.message : "",
  ].filter(Boolean);

  return {
    ran: !finished.error,
    exitCode: finished.exitCode,
    timedOut: finished.timedOut,
    truncated,
    durationMs: Date.now() - startedAt,
    output: redact(
      `$ ${command}\n${Buffer.concat(chunks).toString("utf8")}${notes.length ? `\n${notes.join("\n")}` : ""}`,
    ),
  };
}
