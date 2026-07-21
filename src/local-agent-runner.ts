import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { deriveTrialOutcome, type GraderResult } from "./domain";
import { redact } from "./redact";

const execFileAsync = promisify(execFile);

export const localTrialManifestSchema = z.object({
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
  }),
  agent: z
    .object({
      name: z.string().min(1),
      model: z.string().min(1).optional(),
    })
    .optional(),
});

export type LocalTrialManifest = z.infer<typeof localTrialManifestSchema>;

type LocalEvidence = {
  id: string;
  kind: "manifest" | "agent-instructions" | "source-diff" | "command" | "report";
  createdAt: string;
  content: string;
  redacted: true;
};

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

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "trial-manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(outputDir, "AGENT_INSTRUCTIONS.md"), instructions);
  await writeFile(join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(
    join(outputDir, "status.json"),
    JSON.stringify({ runId, status: "prepared", createdAt }, null, 2),
  );

  return { runId, outputDir, instructionsPath: join(outputDir, "AGENT_INSTRUCTIONS.md") };
}

export async function captureLocalAgentRun(runDirectory: string, workspace: string) {
  const outputDir = resolve(runDirectory);
  const manifest = localTrialManifestSchema.parse(
    JSON.parse(await readFile(join(outputDir, "trial-manifest.json"), "utf8")),
  );
  const startedAt = new Date().toISOString();
  const existing = JSON.parse(
    await readFile(join(outputDir, "evidence.json"), "utf8"),
  ) as LocalEvidence[];
  const sourceDiff = await readGitDiff(workspace);
  const commandResult = manifest.verification.command
    ? await runVerificationCommand(manifest.verification.command, workspace)
    : { ran: false, success: false, output: "No verification command was supplied." };
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
  const results = manifest.verification.criteria.map<GraderResult>((criterion, index) => ({
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

function renderAgentInstructions(manifest: LocalTrialManifest, runId: string) {
  return `# Docs Trials Local Run\n\nRun: \`${runId}\`\n\n## Task\n\n${manifest.task}\n\n## Allowed Documentation\n\n${manifest.documents.map((document) => `- ${document.label}: ${document.value}`).join("\n")}\n\n## Requirements\n\n- Use only the documentation listed above as trial evidence.\n- Work in the supplied workspace.\n- Never add persistent credentials to source, logs, or generated output.\n- Do not claim the trial passed. Docs Trials captures evidence and runs verification separately.\n\n## Suggested Verification\n\n${manifest.verification.criteria.map((criterion) => `- ${criterion}`).join("\n")}\n`;
}

async function readGitDiff(workspace: string) {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["diff", "--binary", "--", "."], {
      cwd: resolve(workspace),
      maxBuffer: 5_000_000,
    });
    return `${stdout}${stderr}` || "No uncommitted source diff was found.";
  } catch (error) {
    return `Unable to collect git diff: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runVerificationCommand(command: string, workspace: string) {
  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd: resolve(workspace),
      shell: true,
      maxBuffer: 5_000_000,
    });
    return { ran: true, success: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const output =
      error && typeof error === "object" && "stdout" in error
        ? `${String(error.stdout ?? "")}${"stderr" in error ? String(error.stderr ?? "") : ""}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { ran: true, success: false, output };
  }
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
