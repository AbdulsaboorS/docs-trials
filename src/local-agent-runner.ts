import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { unavailableBrowserGrade } from "./controlled-run-results";
import { deriveTrialOutcome, type GraderResult } from "./domain";
import { updatesFilterCriteria, updatesFilterSmokeTrial } from "./fixture";
import {
  runLocalUpdatesFilterVerification,
  terminateLocalProcessTree,
  type LocalBrowserConfig,
  type LocalUpdatesFilterVerification,
} from "./local-updates-filter-verifier";
import { redact } from "./redact";

const execFileAsync = promisify(execFile);
const updatesFilterLocalCommand = `${updatesFilterSmokeTrial.runtime.installCommand} && ${updatesFilterSmokeTrial.runtime.buildCommand}`;
const updatesFilterLocalStartCommand = "pnpm dev --host 127.0.0.1 --port 4173 --strictPort";
const updatesFilterLocalPreviewUrl = "http://127.0.0.1:4173";

const localBrowserSchema = z
  .object({
    grader: z.literal("updates-filter-smoke-v1"),
    startCommand: z.string().min(1),
    previewUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
        url.username === "" &&
        url.password === ""
      );
    }, "Local browser verification requires an unauthenticated loopback HTTP URL."),
    startupTimeoutSeconds: z.number().int().min(1).max(60).default(15),
    browserTimeoutSeconds: z.number().int().min(1).max(60).default(30),
  })
  .strict();

export const localTrialManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().min(1),
    task: z.string().min(1),
    documents: z
      .array(
        z.object({
          label: z.string().min(1),
          kind: z.enum(["markdown", "url"]),
          value: z.string().min(1),
        }),
      )
      .min(1),
    starter: z.object({
      type: z.enum(["workspace", "repository"]),
      value: z.string().min(1),
    }),
    verification: z.object({
      profile: z.literal("web-app"),
      criteria: z.array(z.string().min(1)).min(1),
      command: z.string().min(1).optional(),
      browser: localBrowserSchema.optional(),
    }),
    agent: z
      .object({
        name: z.string().min(1),
        model: z.string().min(1).optional(),
      })
      .optional(),
  })
  .superRefine((manifest, context) => {
    if (!manifest.verification.browser) return;
    if (!manifest.verification.command) {
      context.addIssue({
        code: "custom",
        path: ["verification", "command"],
        message: "The updates-filter browser grader requires a build command.",
      });
    } else if (manifest.verification.command !== updatesFilterLocalCommand) {
      context.addIssue({
        code: "custom",
        path: ["verification", "command"],
        message: `The updates-filter browser grader requires the frozen install/build command: ${updatesFilterLocalCommand}`,
      });
    }
    if (manifest.task !== updatesFilterSmokeTrial.task) {
      context.addIssue({
        code: "custom",
        path: ["task"],
        message: "The updates-filter browser grader requires its exact frozen task.",
      });
    }
    if (manifest.verification.browser.startCommand !== updatesFilterLocalStartCommand) {
      context.addIssue({
        code: "custom",
        path: ["verification", "browser", "startCommand"],
        message: `The updates-filter browser grader requires the frozen start command: ${updatesFilterLocalStartCommand}`,
      });
    }
    if (manifest.verification.browser.previewUrl !== updatesFilterLocalPreviewUrl) {
      context.addIssue({
        code: "custom",
        path: ["verification", "browser", "previewUrl"],
        message: `The updates-filter browser grader requires the frozen preview URL: ${updatesFilterLocalPreviewUrl}`,
      });
    }
    if (
      JSON.stringify(manifest.verification.criteria) !==
      JSON.stringify(updatesFilterSmokeTrial.acceptanceCriteria)
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification", "criteria"],
        message: "The updates-filter browser grader requires its exact frozen criteria.",
      });
    }
  });

export type LocalTrialManifest = z.infer<typeof localTrialManifestSchema>;

const localEvidenceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "manifest",
      "agent-instructions",
      "source-diff",
      "command",
      "preview",
      "browser",
      "report",
    ]),
    createdAt: z.iso.datetime(),
    content: z.string(),
    redacted: z.literal(true),
  })
  .strict();

type LocalEvidence = z.infer<typeof localEvidenceSchema>;

const preparedStatusSchema = z
  .object({
    runId: z.string().min(1),
    status: z.literal("prepared"),
    createdAt: z.iso.datetime(),
    workspaceRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strict();

export async function prepareLocalAgentRun(manifestPath: string, workspace: string) {
  const manifest = localTrialManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const runId = `${manifest.id}-${Date.now()}`;
  const outputDir = join(resolve(workspace), ".docs-trials", "runs", runId);
  const createdAt = new Date().toISOString();
  const instructions = renderAgentInstructions(manifest, runId);
  const evidence: LocalEvidence[] = [
    {
      id: "manifest",
      kind: "manifest",
      createdAt,
      content: redact(JSON.stringify(manifest, null, 2)),
      redacted: true,
    },
    {
      id: "agent-instructions",
      kind: "agent-instructions",
      createdAt,
      content: redact(instructions),
      redacted: true,
    },
  ];
  const status = preparedStatusSchema.parse({
    runId,
    status: "prepared",
    createdAt,
    workspaceRevision: await requireCleanGitBaseline(workspace),
  });
  const controlSha256 = sha256(JSON.stringify({ manifest, evidence, status }));

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "trial-manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(outputDir, "AGENT_INSTRUCTIONS.md"), instructions);
  await writeFile(join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(outputDir, "status.json"), JSON.stringify(status, null, 2));

  return {
    runId,
    outputDir,
    instructionsPath: join(outputDir, "AGENT_INSTRUCTIONS.md"),
    controlSha256,
  };
}

type LocalAgentRunnerDependencies = {
  runBrowserVerification: (
    config: LocalBrowserConfig,
    workspace: string,
  ) => Promise<LocalUpdatesFilterVerification>;
};

const defaultDependencies: LocalAgentRunnerDependencies = {
  runBrowserVerification: runLocalUpdatesFilterVerification,
};

export async function captureLocalAgentRun(
  runDirectory: string,
  workspace: string,
  expectedControlSha256: string,
  dependencies: LocalAgentRunnerDependencies = defaultDependencies,
) {
  const outputDir = resolve(runDirectory);
  const manifest = localTrialManifestSchema.parse(
    JSON.parse(await readFile(join(outputDir, "trial-manifest.json"), "utf8")),
  );
  const startedAt = new Date().toISOString();
  const existing = z
    .array(localEvidenceSchema)
    .parse(JSON.parse(await readFile(join(outputDir, "evidence.json"), "utf8")));
  const preparedStatus = preparedStatusSchema.parse(
    JSON.parse(await readFile(join(outputDir, "status.json"), "utf8")),
  );
  if (preparedStatus.runId !== basename(outputDir)) {
    throw new Error("Local run status does not match the run directory.");
  }
  const actualControlSha256 = sha256(
    JSON.stringify({ manifest, evidence: existing, status: preparedStatus }),
  );
  if (
    !/^[a-f0-9]{64}$/.test(expectedControlSha256) ||
    actualControlSha256 !== expectedControlSha256
  ) {
    throw new Error("Local run controls changed after preparation.");
  }
  if (process.platform === "win32") {
    throw new Error(
      "Local command capture is disabled on Windows until descendant process cleanup can be guaranteed.",
    );
  }
  const commandResult = manifest.verification.command
    ? await runVerificationCommand(manifest.verification.command, workspace)
    : { ran: false, success: false, output: "No verification command was supplied." };
  let browserVerification: LocalUpdatesFilterVerification | undefined;
  if (manifest.verification.browser) {
    browserVerification = commandResult.success
      ? await dependencies.runBrowserVerification(manifest.verification.browser, resolve(workspace))
      : skippedBrowserVerification();
  }
  const sourceDiff = await readGitDiff(workspace, preparedStatus.workspaceRevision);
  const evidence: LocalEvidence[] = [
    ...existing,
    {
      id: "source-diff",
      kind: "source-diff",
      createdAt: new Date().toISOString(),
      content: redact(sourceDiff),
      redacted: true,
    },
    {
      id: "verification-command",
      kind: "command",
      createdAt: new Date().toISOString(),
      content: redact(commandResult.output),
      redacted: true,
    },
  ];
  if (browserVerification) {
    evidence.push(
      {
        id: "preview",
        kind: "preview",
        createdAt: new Date().toISOString(),
        content: redact(
          JSON.stringify(
            { result: browserVerification.preview, output: browserVerification.previewOutput },
            null,
            2,
          ),
        ),
        redacted: true,
      },
      {
        id: "browser-session",
        kind: "browser",
        createdAt: new Date().toISOString(),
        content: redact(JSON.stringify(browserSummary(browserVerification), null, 2)),
        redacted: true,
      },
    );
  }
  const results = browserVerification
    ? createBrowserResults(commandResult, browserVerification)
    : createCommandOnlyResults(manifest.verification.criteria, commandResult);
  const outcome = deriveTrialOutcome(manifest.verification.criteria, results);
  const report = renderLocalReport(manifest, basename(outputDir), results, evidence);

  evidence.push({
    id: "report",
    kind: "report",
    createdAt: new Date().toISOString(),
    content: report,
    redacted: true,
  });
  await writeFile(join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(outputDir, "grader-results.json"), JSON.stringify(results, null, 2));
  await writeFile(join(outputDir, "AX.md"), report);
  await writeFile(
    join(outputDir, "report.json"),
    JSON.stringify(
      {
        runId: basename(outputDir),
        outcome,
        status: outcome,
        startedAt,
        completedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(outputDir, "status.json"),
    JSON.stringify({ runId: basename(outputDir), status: outcome }, null, 2),
  );

  return { outputDir, status: outcome };
}

function createCommandOnlyResults(
  criteria: string[],
  commandResult: Awaited<ReturnType<typeof runVerificationCommand>>,
): GraderResult[] {
  return criteria.map<GraderResult>((criterion, index) => ({
    criterion,
    outcome:
      index !== 0 || !commandResult.ran
        ? "inconclusive"
        : commandResult.success
          ? "passed"
          : "failed",
    detail:
      index === 0
        ? commandResult.success
          ? "The user-approved verification command completed successfully."
          : commandResult.ran
            ? "The user-approved verification command failed."
            : "No verification command was supplied."
        : "Not yet verified. Add a deterministic browser verifier before treating this criterion as passed.",
    evidenceIds: ["verification-command"],
  }));
}

function createBrowserResults(
  commandResult: Awaited<ReturnType<typeof runVerificationCommand>>,
  verification: LocalUpdatesFilterVerification,
): GraderResult[] {
  return [
    {
      criterion: updatesFilterCriteria.build,
      outcome: commandResult.success ? "passed" : commandResult.ran ? "failed" : "inconclusive",
      detail: commandResult.success
        ? "The user-approved local build command completed successfully."
        : commandResult.ran
          ? "The user-approved local build command failed."
          : "No local build command was supplied.",
      evidenceIds: ["verification-command"],
    },
    {
      criterion: updatesFilterCriteria.preview,
      outcome: verification.preview.available
        ? "passed"
        : verification.preview.failureKind === "application"
          ? "failed"
          : "inconclusive",
      detail: verification.preview.available
        ? "The frozen local preview became reachable before browser verification."
        : verification.preview.detail,
      evidenceIds: ["preview"],
    },
    ...verification.browser.results,
  ];
}

function skippedBrowserVerification(): LocalUpdatesFilterVerification {
  const detail = "Browser verification was skipped because the local build did not pass.";
  return {
    preview: { available: false, detail, failureKind: "skipped" },
    previewOutput: detail,
    browser: unavailableBrowserGrade(detail),
  };
}

function browserSummary(verification: LocalUpdatesFilterVerification) {
  const { browser } = verification;
  return {
    sessionId: browser.sessionId,
    consoleMessages: browser.consoleMessages,
    networkFailures: browser.networkFailures,
    unexpectedExternalRequests: browser.unexpectedExternalRequests ?? [],
    observations: verification.observations ?? null,
    screenshotCaptured: browser.screenshotCaptured,
  };
}

function renderAgentInstructions(manifest: LocalTrialManifest, runId: string) {
  return `# Docs Trials Local Run\n\nRun: \`${runId}\`\n\n## Task\n\n${manifest.task}\n\n## Allowed Documentation\n\n${manifest.documents.map((document) => `- ${document.label}: ${document.value}`).join("\n")}\n\n## Requirements\n\n- Use only the documentation listed above as trial evidence.\n- Work in the supplied workspace.\n- Never add persistent credentials to source, logs, or generated output.\n- Do not claim the trial passed. Docs Trials captures evidence and runs verification separately.\n\n## Suggested Verification\n\n${manifest.verification.criteria.map((criterion) => `- ${criterion}`).join("\n")}\n`;
}

async function requireCleanGitBaseline(workspace: string): Promise<string> {
  try {
    const [{ stdout: revisionOutput }, { stdout: statusOutput }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: resolve(workspace),
        maxBuffer: 1_000,
      }),
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: resolve(workspace),
        maxBuffer: 1_000_000,
      }),
    ]);
    const revision = revisionOutput.trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error("Git HEAD is invalid.");
    if (statusOutput.trim()) {
      throw new Error("The workspace contains uncommitted or untracked files.");
    }
    return revision;
  } catch (error) {
    throw new Error(
      `Local runs require a clean committed Git baseline: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readGitDiff(workspace: string, baselineRevision: string) {
  const root = resolve(workspace);
  const realRoot = await realpath(root);
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["diff", "--binary", baselineRevision, "--", "."],
      {
        cwd: root,
        maxBuffer: 5_000_000,
      },
    );
    const { stdout: untrackedOutput } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
      {
        cwd: root,
        maxBuffer: 1_000_000,
      },
    );
    let evidence = `${stdout}${stderr}`;
    for (const path of untrackedOutput.split("\0").filter(Boolean)) {
      if (path === ".docs-trials" || path.startsWith(".docs-trials/")) continue;
      const absolutePath = resolve(root, path);
      const relativePath = relative(root, absolutePath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath) ||
        relativePath === ""
      ) {
        continue;
      }
      const pathStats = await lstat(absolutePath);
      if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
        throw new Error(`Unsupported untracked source entry: ${relativePath}`);
      }
      const resolvedPath = await realpath(absolutePath);
      const resolvedRelativePath = relative(realRoot, resolvedPath);
      if (
        resolvedRelativePath === ".." ||
        resolvedRelativePath.startsWith(`..${sep}`) ||
        isAbsolute(resolvedRelativePath)
      ) {
        throw new Error(`Untracked source resolves outside the workspace: ${relativePath}`);
      }
      if (pathStats.size > 1_000_000) {
        throw new Error(`Untracked source exceeds the 1 MB per-file limit: ${relativePath}`);
      }
      const file = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: Buffer;
      try {
        const openedStats = await file.stat();
        if (
          !openedStats.isFile() ||
          openedStats.size > 1_000_000 ||
          openedStats.dev !== pathStats.dev ||
          openedStats.ino !== pathStats.ino
        ) {
          throw new Error(`Untracked source changed while being captured: ${relativePath}`);
        }
        const buffer = Buffer.alloc(openedStats.size + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.byteLength) {
          const read = await file.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        const finalStats = await file.stat();
        if (
          bytesRead !== openedStats.size ||
          finalStats.size !== openedStats.size ||
          finalStats.dev !== openedStats.dev ||
          finalStats.ino !== openedStats.ino
        ) {
          throw new Error(`Untracked source changed while being captured: ${relativePath}`);
        }
        content = buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
      const digest = createHash("sha256").update(content).digest("hex");
      const remaining = 5_000_000 - Buffer.byteLength(evidence);
      if (remaining <= 0) throw new Error("Source evidence exceeds the 5 MB run limit.");
      let body: string;
      try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        body = `[binary file omitted; sha256:${digest}]`;
      }
      const entry = `\n--- /dev/null\n+++ b/${relativePath}\n# untracked sha256:${digest}\n${body}\n`;
      if (Buffer.byteLength(entry) > remaining) {
        throw new Error("Source evidence exceeds the 5 MB run limit.");
      }
      evidence += entry;
    }
    return evidence || "No generated source change was found.";
  } catch (error) {
    throw new Error(
      `Unable to collect source evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runVerificationCommand(command: string, workspace: string) {
  const child = spawn(command, {
    cwd: resolve(workspace),
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  let truncated = false;
  const append = (chunk: Buffer) => {
    const remaining = 5_000_000 - outputBytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const bounded = chunk.subarray(0, remaining);
    chunks.push(bounded);
    outputBytes += bounded.byteLength;
    if (bounded.byteLength < chunk.byteLength) truncated = true;
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const completion = await new Promise<{
    code: number | null;
    error?: Error;
    timedOut: boolean;
  }>((resolveCompletion) => {
    let settled = false;
    const finish = (result: { code: number | null; error?: Error; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveCompletion(result);
    };
    const timeout = setTimeout(() => finish({ code: null, timedOut: true }), 120_000);
    child.once("error", (error) => finish({ code: null, error, timedOut: false }));
    child.once("close", (code) => finish({ code, timedOut: false }));
  });
  await terminateLocalProcessTree(child);
  const suffix = completion.timedOut
    ? "\nVerification command exceeded the 120 second limit."
    : truncated
      ? "\nVerification command output exceeded the 5 MB evidence limit."
      : completion.error
        ? `\n${completion.error.message}`
        : "";
  return {
    ran: !completion.error,
    success: completion.code === 0 && !completion.timedOut && !truncated,
    output: `${Buffer.concat(chunks).toString("utf8")}${suffix}`,
  };
}

function renderLocalReport(
  manifest: LocalTrialManifest,
  runId: string,
  results: GraderResult[],
  evidence: LocalEvidence[],
) {
  const outcome = deriveTrialOutcome(manifest.verification.criteria, results);
  const table = results
    .map((result) => `| ${result.outcome.toUpperCase()} | ${result.criterion} | ${result.detail} |`)
    .join("\n");
  const failed = results.filter((result) => result.outcome === "failed");
  const unresolved = results.filter((result) => result.outcome === "inconclusive");
  const recommendation =
    failed.length > 0
      ? "A deterministic check failed. Diagnose the recorded command evidence before attributing the failure to documentation."
      : unresolved.length > 0
        ? "More verification is required before diagnosing documentation quality. Add a deterministic browser verifier for the unresolved criteria; this runner does not infer that the docs are at fault."
        : "No deterministic criterion failed.";
  return `# Agent Experience Report\n\n## Outcome\n\n**${outcome.toUpperCase()}** for \`${manifest.title}\` (run \`${runId}\`).\n\n## Task\n\n${manifest.task}\n\n## Evidence Mode\n\nAgent-neutral local run. Agent: ${manifest.agent ? `${manifest.agent.name}${manifest.agent.model ? ` (${manifest.agent.model})` : ""}` : "not declared"}.\n\n## Deterministic Results\n\n| Result | Criterion | Detail |\n|---|---|---|\n${table}\n\n## Documentation Recommendation\n\n${recommendation}\n\n## Evidence\n\n${evidence.map((item) => `- \`${item.id}\` (${item.kind})`).join("\n")}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
