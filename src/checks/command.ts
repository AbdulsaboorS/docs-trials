import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { redact } from "../core/redact";
import { commandEnvironment, describeCommandEnvironment } from "../util/environment";
import { delay, terminateProcessTree, trackChild } from "../util/process";

const maxOutputBytes = 1_000_000;

export type CommandOutcome = {
  ran: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  cleanupSucceeded: boolean;
  output: string;
  durationMs: number;
};

export function succeeded(command: CommandOutcome): boolean {
  return (
    command.ran &&
    command.exitCode === 0 &&
    command.signalCode === null &&
    !command.timedOut &&
    command.cleanupSucceeded
  );
}

export async function runCommand(
  command: string,
  workspace: string,
  timeoutSeconds: number,
  allowedEnvironment: readonly string[] = [],
): Promise<CommandOutcome> {
  const startedAt = Date.now();
  const environment = commandEnvironment(allowedEnvironment, {
    CI: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  });
  const child = spawn(command, {
    cwd: resolve(workspace),
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: environment.values,
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
    signalCode: NodeJS.Signals | null;
    error?: Error;
    timedOut: boolean;
  }>((settle) => {
    let done = false;
    const finish = (value: {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      error?: Error;
      timedOut: boolean;
    }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(value);
    };
    const timer = setTimeout(
      () => finish({ exitCode: null, signalCode: null, timedOut: true }),
      timeoutSeconds * 1_000,
    );
    child.once("error", (error) =>
      finish({ exitCode: null, signalCode: null, error, timedOut: false }),
    );
    child.once("close", (code, signal) =>
      finish({ exitCode: code, signalCode: signal, timedOut: false }),
    );
  });

  const cleanupSucceeded = await terminateProcessTree(child);
  await delay(50);

  const notes = [
    describeCommandEnvironment(environment),
    finished.timedOut ? `Command exceeded the ${timeoutSeconds} second limit.` : "",
    finished.signalCode ? `Command ended after signal ${finished.signalCode}.` : "",
    cleanupSucceeded ? "" : "The command process group could not be fully terminated.",
    truncated ? `Output was truncated at ${maxOutputBytes} bytes.` : "",
    finished.error ? finished.error.message : "",
  ].filter(Boolean);

  return {
    ran: !finished.error,
    exitCode: finished.exitCode,
    signalCode: finished.signalCode,
    timedOut: finished.timedOut,
    truncated,
    cleanupSucceeded,
    durationMs: Date.now() - startedAt,
    output: redact(
      `$ ${command}\n${Buffer.concat(chunks).toString("utf8")}${notes.length ? `\n${notes.join("\n")}` : ""}`,
    ),
  };
}
