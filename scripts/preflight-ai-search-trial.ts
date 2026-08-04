import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  aiSearchPrivateRunSchema,
  assertFrozenAiSearchPrivateRun,
  sha256,
} from "../src/ai-search/contract";
import {
  aiSearchObservationsSchema,
  assertNonLiveAiSearchObservations,
  deriveAiSearchTerminalOutcome,
  gradeAiSearchTrial,
  type AiSearchObservations,
} from "../src/ai-search/grader";
import { trialRunSchema, type Evidence, type TrialEvent } from "../src/domain";
import { redact } from "../src/redact";
import { renderAXReport } from "../src/report";

const args = process.argv.slice(2);
const normalized = args[0] === "--" ? args.slice(1) : args;
const runArgument = normalized[0];
if (!runArgument) {
  throw new Error("Usage: pnpm trial:ai-search:preflight -- <run-directory>");
}

const runDirectory = resolve(runArgument);
const outputDirectory = join(runDirectory, "preflight");
const temporaryDirectory = join(runDirectory, `.preflight-${crypto.randomUUID()}`);
const lockPath = join(runDirectory, ".preflight.lock");
const lock = await open(lockPath, "wx").catch((error: unknown) => {
  if (hasCode(error, "EEXIST")) {
    throw new Error("AI Search preflight is already running for this package.");
  }
  throw error;
});
let committed = false;

try {
  if (await exists(outputDirectory)) {
    throw new Error("AI Search preflight output already exists and will not be overwritten.");
  }

  const prepared = aiSearchPrivateRunSchema.parse(
    JSON.parse(await readFile(join(runDirectory, "private-run.json"), "utf8")),
  );
  await assertFrozenAiSearchPrivateRun(prepared);
  await verifyKnowledgeFiles(runDirectory, prepared);
  await verifyResourceSnapshots(runDirectory, prepared);

  const verificationStartedAt = new Date().toISOString();
  const observations = createNonLiveObservations(verificationStartedAt);
  assertNonLiveAiSearchObservations(observations);
  const graderResults = gradeAiSearchTrial(prepared, observations);
  const outcome = deriveAiSearchTerminalOutcome(prepared.trial.acceptanceCriteria, graderResults);
  const completedAt = new Date().toISOString();
  const evidence = createEvidence(prepared, observations);
  const events = createEvents(verificationStartedAt, completedAt, evidence);
  const run = trialRunSchema.parse({
    id: prepared.runId,
    specId: prepared.trial.id,
    startedAt: verificationStartedAt,
    completedAt,
    status: outcome,
    events,
    evidence,
    graderResults,
  });
  const report = renderAXReport(prepared.trial, run, {
    evidenceMode:
      "Non-live connected-trial preflight. No provider adapter ran and no Cloudflare resource was created. Unavailable checks remain inconclusive, and cleanup status is not attributed to documentation quality.",
  });
  const cleanupVerified = graderResults.at(-1)?.outcome === "passed";

  await mkdir(temporaryDirectory);
  await Promise.all([
    writeFile(
      join(temporaryDirectory, "grader-results.json"),
      JSON.stringify(graderResults, null, 2),
    ),
    writeFile(join(temporaryDirectory, "trial-run.json"), JSON.stringify(run, null, 2)),
    writeFile(join(temporaryDirectory, "evidence.json"), JSON.stringify(evidence, null, 2)),
    writeFile(
      join(temporaryDirectory, "report.json"),
      JSON.stringify(
        { ...report, contractSha256: prepared.contractSha256, cleanupVerified },
        null,
        2,
      ),
    ),
    writeFile(join(temporaryDirectory, "AX.md"), report.markdown),
  ]);
  await rename(temporaryDirectory, outputDirectory);
  committed = true;

  console.log(
    JSON.stringify({
      runId: prepared.runId,
      outcome,
      cleanupVerified,
      runDirectory,
      preflightDirectory: outputDirectory,
      contractSha256: prepared.contractSha256,
      liveResourcesCreated: false,
    }),
  );
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
  if (!committed) await rm(temporaryDirectory, { recursive: true, force: true });
}

function createNonLiveObservations(collectedAt: string): AiSearchObservations {
  const unavailable = {
    available: false as const,
    collectedAt,
    detail: "Not run. A trusted live provider adapter has not been implemented.",
  };
  return aiSearchObservationsSchema.parse({
    build: unavailable,
    instances: unavailable,
    indexing: unavailable,
    mcp: unavailable,
    credentialScan: unavailable,
    cleanup: unavailable,
  });
}

async function verifyKnowledgeFiles(
  runDirectory: string,
  prepared: ReturnType<typeof aiSearchPrivateRunSchema.parse>,
): Promise<void> {
  for (const document of prepared.knowledge.documents) {
    const content = await readFile(
      join(runDirectory, "workspace", "knowledge", document.key),
      "utf8",
    );
    if ((await sha256(content)) !== document.sha256) {
      throw new Error(`Frozen knowledge document was modified: ${document.key}`);
    }
  }
}

async function verifyResourceSnapshots(
  runDirectory: string,
  prepared: ReturnType<typeof aiSearchPrivateRunSchema.parse>,
): Promise<void> {
  for (const resource of prepared.resourceSnapshots) {
    const content = await readFile(join(runDirectory, "workspace", resource.path), "utf8");
    if ((await sha256(content)) !== resource.sha256) {
      throw new Error(`Assigned documentation snapshot was modified: ${resource.path}`);
    }
  }
}

function createEvidence(
  prepared: ReturnType<typeof aiSearchPrivateRunSchema.parse>,
  observations: AiSearchObservations,
): Evidence[] {
  const entries = [
    [
      "frozen-contract",
      "input",
      {
        collectedAt: prepared.createdAt,
        contractSha256: prepared.contractSha256,
        starterRevision: prepared.trial.starterRepository.revision,
        resourceSnapshots: prepared.resourceSnapshots.map(({ locator, path, sha256 }) => ({
          locator,
          path,
          sha256,
        })),
        documentDigests: prepared.knowledge.documents.map(({ key, sha256 }) => ({ key, sha256 })),
      },
    ],
    ["command-build", "command", observations.build],
    ["ai-search-instance", "grader", observations.instances],
    ["ai-search-items", "grader", observations.indexing],
    ["mcp-session", "grader", observations.mcp],
    ["credential-scan", "grader", observations.credentialScan],
    ["cleanup", "grader", observations.cleanup],
  ] as const;
  return entries.map(([id, kind, content]) => ({
    id,
    kind,
    createdAt: content.collectedAt,
    mediaType: "application/json",
    content: redact(JSON.stringify(content)),
    redacted: true,
  }));
}

function createEvents(startedAt: string, completedAt: string, evidence: Evidence[]): TrialEvent[] {
  return [
    {
      id: "event-verify-started",
      at: startedAt,
      phase: "verify",
      type: "started",
      message: "Non-live connected preflight started.",
      evidenceIds: ["frozen-contract"],
    },
    {
      id: "event-verify-completed",
      at: completedAt,
      phase: "verify",
      type: "completed",
      message: "Unavailable connected checks were reported without live execution.",
      evidenceIds: evidence.map((item) => item.id),
    },
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
