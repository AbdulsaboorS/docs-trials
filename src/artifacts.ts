import { Buffer } from "node:buffer";
import type { ExecutionSession } from "@cloudflare/sandbox";
import { z } from "zod";
import type { AXReport, TrialRun, TrialSpec } from "./domain";
import type { PlatformEnv } from "./platform-env";
import { redact, redactValue } from "./redact";
import type { StarterFile } from "./starter-assets";

const artifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const artifactWorkspacePath = "/workspace/artifact";
const artifactTokenTtlSeconds = 600;
const artifactCommandTimeoutMs = 60_000;
const maxArtifactFiles = 250;
const maxArtifactPathBytes = 240;
const packageManifestPath = ".docs-trials-package.json";
const safeArtifactPathPart = /^[A-Za-z0-9._@+-]+$/;

export function redactArtifactError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

export type ArtifactFile = {
  path: string;
  mediaType: string;
  content: string | Uint8Array;
};

export type TrialArtifactPackage = {
  repository: string;
  files: ArtifactFile[];
};

export interface ArtifactRepository {
  save(trialPackage: TrialArtifactPackage): Promise<{ repository: string; version: string }>;
  delete(repository: string): Promise<boolean>;
}

export interface ArtifactGitWorkspace {
  persist(input: {
    repository: string;
    remote: string;
    token: string;
    digest: string;
    files: ArtifactFile[];
  }): Promise<string>;
}

export type ArtifactGitWorkspaceFactory = (repository: string) => ArtifactGitWorkspace;

export class CloudflareArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly artifacts: Artifacts,
    private readonly workspaceFactory: ArtifactGitWorkspaceFactory,
  ) {}

  async save(trialPackage: TrialArtifactPackage): Promise<{ repository: string; version: string }> {
    const repository = artifactNameSchema.parse(trialPackage.repository);
    const files = normalizedArtifactFiles(trialPackage.files);
    const digest = await artifactPackageDigest(files);
    let repo: ArtifactsRepo | undefined;
    let initialToken: string | undefined;
    let token: string | undefined;
    let created = false;
    let stored: { repository: string; version: string } | undefined;
    let failure: unknown;

    try {
      try {
        const result = await this.artifacts.create(repository, {
          description: `Docs Trials evidence for ${repository}`,
          readOnly: false,
          setDefaultBranch: "main",
        });
        created = true;
        initialToken = result.token;
      } catch (error) {
        if (artifactErrorCode(error) !== "ALREADY_EXISTS") throw error;
      }

      repo = await this.artifacts.get(repository);
      if (initialToken) {
        const revoked = await repo.revokeToken(initialToken);
        if (!revoked) throw new Error("Artifacts initial repository token was not revoked.");
        initialToken = undefined;
      }
      const staleTokens = await repo.listTokens();
      for (const stale of staleTokens.tokens) {
        if (stale.scope === "write" && stale.state === "active") {
          await repo.revokeToken(stale.id);
        }
      }
      const issued = await repo.createToken("write", artifactTokenTtlSeconds);
      token = issued.plaintext;

      const version = await this.workspaceFactory(repository).persist({
        repository,
        remote: repo.remote,
        token,
        digest,
        files,
      });
      stored = { repository, version };
    } catch (error) {
      failure = error;
    }

    const cleanupErrors: string[] = [];
    if (repo && token) {
      try {
        if (!(await repo.revokeToken(token))) cleanupErrors.push("write token was not revoked");
        const remaining = await repo.listTokens();
        if (remaining.tokens.some((item) => item.scope === "write" && item.state === "active")) {
          cleanupErrors.push("active write token remained after persistence");
        }
      } catch (error) {
        cleanupErrors.push(redactArtifactError(error));
      }
    }
    if (created && !stored) {
      try {
        await this.artifacts.delete(repository);
      } catch (error) {
        cleanupErrors.push(`partial repository deletion failed: ${redactArtifactError(error)}`);
      }
    }

    if (failure || cleanupErrors.length > 0) {
      const detail = [failure ? redactArtifactError(failure) : undefined, ...cleanupErrors]
        .filter(Boolean)
        .join("; ");
      throw new Error(`Artifacts persistence failed: ${detail}`);
    }
    if (!stored) throw new Error("Artifacts persistence failed without a result.");
    return stored;
  }

  delete(repository: string): Promise<boolean> {
    return this.artifacts.delete(artifactNameSchema.parse(repository));
  }
}

export function artifactRepositoryForEnv(env: PlatformEnv): ArtifactRepository {
  return new CloudflareArtifactRepository(
    env.ARTIFACTS,
    (repository) => new SandboxArtifactGitWorkspace(env.Sandbox, repository),
  );
}

export async function destroyArtifactPersistenceSandbox(
  env: PlatformEnv,
  repository: string,
): Promise<void> {
  await (await getArtifactSandbox(env.Sandbox, artifactNameSchema.parse(repository))).destroy();
}

class SandboxArtifactGitWorkspace implements ArtifactGitWorkspace {
  constructor(
    private readonly sandboxBinding: PlatformEnv["Sandbox"],
    private readonly repository: string,
  ) {}

  async persist(input: {
    repository: string;
    remote: string;
    token: string;
    digest: string;
    files: ArtifactFile[];
  }): Promise<string> {
    let sandbox = await this.getSandbox();
    try {
      let session: ExecutionSession;
      try {
        session = await sandbox.createSession({
          id: `persist-${this.repository}`,
          cwd: artifactWorkspacePath,
          commandTimeoutMs: artifactCommandTimeoutMs,
        });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "SessionAlreadyExistsError") throw error;
        await sandbox.destroy();
        sandbox = await this.getSandbox();
        session = await sandbox.createSession({
          id: `persist-${this.repository}`,
          cwd: artifactWorkspacePath,
          commandTimeoutMs: artifactCommandTimeoutMs,
        });
      }

      await requireSuccessfulArtifactOperation(
        "create persistence workspace",
        session.mkdir(artifactWorkspacePath, { recursive: true }),
      );
      const gitEnv = gitAuthenticationEnv(input.remote, input.token);
      await successfulCommand(session, 'git clone "$ARTIFACTS_REMOTE" .', gitEnv);

      const head = await session.exec("git rev-parse --verify HEAD", {
        cwd: artifactWorkspacePath,
        timeout: artifactCommandTimeoutMs,
      });
      const existingManifest = await session.exists(
        `${artifactWorkspacePath}/${packageManifestPath}`,
      );
      if (existingManifest.exists) {
        const storedManifest = await requireSuccessfulArtifactOperation(
          "read package manifest",
          session.readFile(`${artifactWorkspacePath}/${packageManifestPath}`),
        );
        const manifest = packageManifestSchema.parse(JSON.parse(storedManifest.content));
        if (manifest.repository !== input.repository || manifest.digest !== input.digest) {
          throw new Error("Artifacts repository already contains a different evidence package.");
        }
        if (!head.success)
          throw new Error("Artifacts package manifest exists without a Git commit.");
        await verifyExistingPackage(session, input.files);
        return head.stdout.trim();
      }
      if (head.success) {
        throw new Error("Artifacts repository already contains unrecognized content.");
      }

      for (const file of input.files) {
        const absolutePath = `${artifactWorkspacePath}/${file.path}`;
        const parent = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
        await requireSuccessfulArtifactOperation(
          `create parent directory for ${file.path}`,
          session.mkdir(parent, { recursive: true }),
        );
        if (typeof file.content === "string") {
          await requireSuccessfulArtifactOperation(
            `write ${file.path}`,
            session.writeFile(absolutePath, file.content),
          );
        } else {
          await requireSuccessfulArtifactOperation(
            `write ${file.path}`,
            session.writeFile(absolutePath, Buffer.from(file.content).toString("base64"), {
              encoding: "base64",
            }),
          );
        }
      }
      await requireSuccessfulArtifactOperation(
        "write package manifest",
        session.writeFile(
          `${artifactWorkspacePath}/${packageManifestPath}`,
          `${JSON.stringify({ schemaVersion: 1, repository: input.repository, digest: input.digest }, null, 2)}\n`,
        ),
      );

      const commitEnv = {
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      };
      await successfulCommand(session, "git add --all", commitEnv);
      await successfulCommand(
        session,
        'git -c user.name="Docs Trials" -c user.email="artifacts@docs-trials.local" commit -m "Persist trial evidence"',
        commitEnv,
      );
      const committed = await successfulCommand(session, "git rev-parse HEAD", {});
      const version = committed.stdout.trim();
      await verifyExistingPackage(session, input.files);
      await successfulCommand(session, "git push origin HEAD:main", gitEnv);
      const remote = await successfulCommand(
        session,
        "git ls-remote origin refs/heads/main",
        gitEnv,
      );
      if (remote.stdout.trim().split(/\s+/)[0] !== version) {
        throw new Error("Artifacts remote revision did not match the persisted commit.");
      }
      return version;
    } finally {
      await sandbox.destroy();
    }
  }

  private getSandbox() {
    return getArtifactSandbox(this.sandboxBinding, this.repository);
  }
}

const packageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  repository: artifactNameSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

async function getArtifactSandbox(binding: PlatformEnv["Sandbox"], repository: string) {
  const { getSandbox } = await import("@cloudflare/sandbox");
  return getSandbox(binding, `artifact-${repository}`, {
    transport: "rpc",
    enableDefaultSession: false,
    normalizeId: true,
    sleepAfter: "10m",
  });
}

export function assembleTrialArtifactPackage(input: {
  spec: TrialSpec;
  run: TrialRun;
  report: AXReport;
  generatedSource: StarterFile[];
  agentTrace: unknown;
  commands: unknown;
  browserSummary: unknown;
  screenshot?: Uint8Array;
  maxBytes: number;
}): TrialArtifactPackage {
  const screenshot = input.spec.id === "updates-filter-smoke-v1" ? input.screenshot : undefined;
  const files: ArtifactFile[] = [
    jsonFile("trial.json", input.spec),
    jsonFile("run.json", input.run),
    jsonLineFile("agent-trace.jsonl", input.agentTrace),
    jsonLineFile("commands.jsonl", input.commands),
    jsonFile("browser-evidence/summary.json", input.browserSummary),
    jsonFile("grader-results.json", input.run.graderResults),
    { path: "AX.md", mediaType: "text/markdown", content: redact(input.report.markdown) },
    ...input.generatedSource.map((file) => ({
      path: artifactPath(`generated-source/${file.path}`),
      mediaType: sourceMediaType(file.path),
      content: redact(file.content),
    })),
    ...(screenshot
      ? [
          {
            path: "browser-evidence/final.png",
            mediaType: "image/png",
            content: screenshot,
          },
        ]
      : []),
  ];
  const bytes = files.reduce(
    (total, file) =>
      total +
      new TextEncoder().encode(file.path).byteLength +
      (typeof file.content === "string"
        ? new TextEncoder().encode(file.content).byteLength
        : file.content.byteLength),
    0,
  );
  if (bytes > input.maxBytes) throw new Error("Trial artifact package exceeds evidence limit.");
  return {
    repository: artifactNameSchema.parse(input.run.id),
    files: normalizedArtifactFiles(files),
  };
}

function jsonFile(path: string, value: unknown): ArtifactFile {
  return {
    path: artifactPath(path),
    mediaType: "application/json",
    content: redact(JSON.stringify(redactValue(value), null, 2)),
  };
}

function jsonLineFile(path: string, value: unknown): ArtifactFile {
  return {
    path: artifactPath(path),
    mediaType: "application/x-ndjson",
    content: `${redact(JSON.stringify(redactValue(value)))}\n`,
  };
}

function artifactPath(path: string): string {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    parts.some(
      (part) => part === "" || part === "." || part === ".." || !safeArtifactPathPart.test(part),
    )
  ) {
    throw new Error(`Invalid artifact path: ${path}`);
  }
  return path;
}

function sourceMediaType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "text/javascript";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  return "text/plain";
}

function normalizedArtifactFiles(files: ArtifactFile[]): ArtifactFile[] {
  if (files.length > maxArtifactFiles) {
    throw new Error(`Trial artifact package exceeds ${maxArtifactFiles} files.`);
  }
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 0; index < sorted.length; index += 1) {
    const file = sorted[index];
    if (!file) continue;
    artifactPath(file.path);
    if (new TextEncoder().encode(file.path).byteLength > maxArtifactPathBytes) {
      throw new Error(`Artifact path exceeds ${maxArtifactPathBytes} bytes: ${file.path}`);
    }
    if (sorted[index - 1]?.path === file.path) {
      throw new Error(`Duplicate artifact path: ${file.path}`);
    }
  }
  return sorted;
}

async function artifactPackageDigest(files: ArtifactFile[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks = files.flatMap((file) => {
    const content = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    return [encoder.encode(`${file.path}\0${file.mediaType}\0${content.byteLength}\0`), content];
  });
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function artifactErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function gitAuthenticationEnv(remote: string, token: string): Record<string, string> {
  return {
    ARTIFACTS_REMOTE: remote,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function successfulCommand(
  session: ExecutionSession,
  command: string,
  env: Record<string, string>,
) {
  const result = await session.exec(command, {
    cwd: artifactWorkspacePath,
    timeout: artifactCommandTimeoutMs,
    env,
  });
  if (!result.success) {
    const output = redact(result.stderr || result.stdout).slice(0, 2_000);
    throw new Error(`Artifacts Git command failed with exit ${result.exitCode}: ${output}`);
  }
  return result;
}

export async function requireSuccessfulArtifactOperation<
  Result extends { success: boolean; exitCode?: number },
>(label: string, operation: Promise<Result>): Promise<Result> {
  const result = await operation;
  if (!result.success) {
    throw new Error(`${label} failed with exit ${result.exitCode ?? "unknown"}.`);
  }
  return result;
}

async function verifyExistingPackage(
  session: ExecutionSession,
  files: ArtifactFile[],
): Promise<void> {
  const tree = await successfulCommand(session, "git ls-tree -r --name-only HEAD", {});
  const actualPaths = tree.stdout.trim().split("\n").filter(Boolean).sort();
  const expectedPaths = [...files.map((file) => file.path), packageManifestPath].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Artifacts repository tree did not match the expected evidence package.");
  }

  for (const file of files) {
    const absolutePath = `${artifactWorkspacePath}/${file.path}`;
    if (typeof file.content === "string") {
      const stored = await requireSuccessfulArtifactOperation(
        `read ${file.path}`,
        session.readFile(absolutePath, { encoding: "utf-8" }),
      );
      if (stored.content !== file.content) {
        throw new Error(`Artifacts repository content did not match ${file.path}.`);
      }
    } else {
      const stored = await requireSuccessfulArtifactOperation(
        `read ${file.path}`,
        session.readFile(absolutePath, { encoding: "base64" }),
      );
      if (stored.content !== Buffer.from(file.content).toString("base64")) {
        throw new Error(`Artifacts repository content did not match ${file.path}.`);
      }
    }
  }
}
