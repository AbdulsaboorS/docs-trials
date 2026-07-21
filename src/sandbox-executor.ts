import {
  getSandbox,
  ProcessExitedBeforeReadyError,
  ProcessReadyTimeoutError,
  type ExecutionSession,
  type Process,
} from "@cloudflare/sandbox";
import type { TrialSpec } from "./domain";
import type { PlatformEnv } from "./platform-env";
import { redact } from "./redact";
import type { RunLimits } from "./run-policy";
import type { StarterFile } from "./starter-assets";
import { resolveWorkspacePath } from "./trial-tool-policy";

const allowedLifecycleCommands = new Set(["install", "build", "start"]);
const workspacePath = "/workspace/app";
const maxGeneratedSourceFiles = 240;

export type SandboxWorkspace = {
  sandboxId: string;
  sessionId: string;
  workspacePath: string;
};

export type PreviewHandle = {
  processId: string;
  url: string;
};

export class PreviewApplicationError extends Error {}

export function getTrialSandbox(env: PlatformEnv, runId: string) {
  return getSandbox(env.Sandbox, `trial-${runId}`, {
    transport: "rpc",
    enableDefaultSession: false,
    normalizeId: true,
    sleepAfter: "10m",
  });
}

export async function prepareSandboxWorkspace(
  env: PlatformEnv,
  runId: string,
  files: StarterFile[],
  limits: RunLimits,
): Promise<SandboxWorkspace> {
  const sandbox = getTrialSandbox(env, runId);
  const sessionId = `run-${runId}`;
  let session: ExecutionSession;
  try {
    session = await sandbox.createSession({
      id: sessionId,
      cwd: workspacePath,
      commandTimeoutMs: limits.maxSandboxSeconds * 1_000,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "SessionAlreadyExistsError") throw error;
    session = await sandbox.getSession(sessionId);
  }
  await session.mkdir(workspacePath, { recursive: true });
  for (const file of files) {
    await session.writeFile(resolveWorkspacePath(file.path), file.content);
  }
  return { sandboxId: `trial-${runId}`, sessionId: session.id, workspacePath };
}

export async function executeSandboxLifecycleCommand(
  env: PlatformEnv,
  runId: string,
  phase: "install" | "build" | "start",
  command: string,
  limits: RunLimits,
) {
  if (!allowedLifecycleCommands.has(phase)) {
    throw new Error(`Unsupported sandbox lifecycle phase: ${phase}`);
  }

  const session = await getTrialSession(env, runId);
  const result = await session.exec(command, {
    cwd: workspacePath,
    timeout: limits.maxSandboxSeconds * 1_000,
  });
  return {
    phase,
    success: result.success,
    stdout: boundedRedactedOutput(result.stdout, limits.maxCommandOutputBytes),
    stderr: boundedRedactedOutput(result.stderr, limits.maxCommandOutputBytes),
    exitCode: result.exitCode,
  };
}

export async function startSandboxPreview(
  env: PlatformEnv,
  runId: string,
  spec: TrialSpec,
  limits: RunLimits,
): Promise<PreviewHandle> {
  const session = await getTrialSession(env, runId);
  const processId = `preview-${runId}`;
  const process =
    (await session.getProcess(processId)) ??
    (await session.startProcess(spec.runtime.startCommand, {
      cwd: workspacePath,
      processId,
      autoCleanup: false,
    }));
  try {
    await process.waitForPort(4173, { timeout: limits.maxBrowserSeconds * 1_000 });
  } catch (error) {
    await Promise.allSettled([process.kill()]);
    if (
      error instanceof ProcessExitedBeforeReadyError ||
      error instanceof ProcessReadyTimeoutError
    ) {
      throw new PreviewApplicationError(`Preview process did not become ready: ${error.message}`);
    }
    throw error;
  }
  const tunnel = await getTrialSandbox(env, runId).tunnels.get(4173);
  if (!("url" in tunnel) || !tunnel.url) {
    await process.kill();
    throw new Error("Sandbox quick tunnel did not provide a preview URL.");
  }
  return { processId: process.id, url: tunnel.url };
}

export async function collectGeneratedSource(
  env: PlatformEnv,
  runId: string,
  limits: RunLimits,
): Promise<StarterFile[]> {
  const session = await getTrialSession(env, runId);
  const listed = await session.listFiles(workspacePath, { recursive: true, includeHidden: true });
  if (!listed.success) {
    throw new Error(`Generated source listing failed with exit ${listed.exitCode ?? "unknown"}.`);
  }
  const sourceFiles = listed.files.filter(
    (file) =>
      file.type === "file" &&
      !file.relativePath.split("/").some((part) => ["node_modules", "dist", ".git"].includes(part)),
  );
  if (sourceFiles.length > maxGeneratedSourceFiles) {
    throw new Error(`Generated source exceeds ${maxGeneratedSourceFiles} files.`);
  }
  const files: StarterFile[] = [];
  let bytes = 0;

  for (const file of sourceFiles) {
    bytes += file.size;
    if (bytes > limits.maxEvidenceBytes)
      throw new Error("Generated source exceeds evidence limit.");
    const result = await session.readFile(file.absolutePath);
    if (!result.success) {
      throw new Error(
        `Generated source read failed for ${file.relativePath} with exit ${result.exitCode ?? "unknown"}.`,
      );
    }
    files.push({ path: file.relativePath, content: redact(result.content) });
  }
  return files;
}

export async function destroyTrialSandbox(env: PlatformEnv, runId: string): Promise<void> {
  await getTrialSandbox(env, runId).destroy();
}

export async function stopPreview(process: Process): Promise<void> {
  await process.kill();
}

async function getTrialSession(env: PlatformEnv, runId: string): Promise<ExecutionSession> {
  return getTrialSandbox(env, runId).getSession(`run-${runId}`);
}

function boundedRedactedOutput(value: string, maxBytes: number): string {
  const redacted = redact(value);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(redacted);
  if (encoded.byteLength <= maxBytes) return redacted;
  const marker = encoder.encode("\n[OUTPUT TRUNCATED]");
  return `${new TextDecoder().decode(encoded.slice(0, maxBytes - marker.byteLength))}${new TextDecoder().decode(marker)}`;
}
