import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { manifestSchema } from "./manifest";
import { checkResultSchema, outcomeSchema } from "./outcome";
import { redact } from "./redact";

/**
 * Runs live outside the workspace the agent is working in.
 *
 * Keeping the run directory out of the workspace stops Docs Trials from
 * dirtying the Git baseline it records. It does not isolate the record from
 * other processes that use the operator's account.
 */
export function runsRoot(): string {
  return process.env.DOCS_TRIALS_HOME
    ? resolve(process.env.DOCS_TRIALS_HOME)
    : join(homedir(), ".docs-trials", "runs");
}

export const runRecordSchema = z
  .object({
    runId: z.string().min(1),
    status: z.enum(["prepared", "verified"]),
    manifest: manifestSchema,
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    workspace: z.string().min(1),
    baselineRevision: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/)
      .optional(),
    preparedAt: z.iso.datetime(),
    verification: z
      .object({
        startedAt: z.iso.datetime(),
        completedAt: z.iso.datetime(),
        outcome: outcomeSchema,
        results: z.array(checkResultSchema),
      })
      .optional(),
  })
  .strict();

export type RunRecord = z.infer<typeof runRecordSchema>;

export function runDirectory(runId: string): string {
  return join(runsRoot(), runId);
}

export function createRunId(manifestId: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `${manifestId}-${stamp}`;
}

export async function writeRunRecord(record: RunRecord): Promise<string> {
  const directory = runDirectory(record.runId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "run.json");
  await writeFile(path, `${JSON.stringify(runRecordSchema.parse(record), null, 2)}\n`);
  return path;
}

export async function readRunRecord(runIdOrPath: string): Promise<RunRecord> {
  const directory = await resolveRunDirectory(runIdOrPath);
  const path = join(directory, "run.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`No run record at ${path}. Run \`docs-trials prepare\` first.`);
  }
  return runRecordSchema.parse(JSON.parse(raw));
}

/** Accepts a run id, a run directory, or `latest`. */
export async function resolveRunDirectory(runIdOrPath: string): Promise<string> {
  if (runIdOrPath === "latest") {
    const latest = await latestRunId();
    if (!latest) throw new Error(`No runs found under ${runsRoot()}.`);
    return runDirectory(latest);
  }
  if (runIdOrPath.includes("/") || isAbsolute(runIdOrPath)) return resolve(runIdOrPath);
  return runDirectory(runIdOrPath);
}

export async function latestRunId(): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(runsRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  return entries.sort().at(-1);
}

export async function writeEvidence(runId: string, id: string, content: string): Promise<string> {
  const directory = join(runDirectory(runId), "evidence");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${id}.txt`);
  await writeFile(path, redact(content));
  return path;
}

export async function writeArtifact(runId: string, name: string, content: string): Promise<string> {
  const directory = runDirectory(runId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}
