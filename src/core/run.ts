import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  documentationFileSchema,
  documentationProvenanceSchema,
  maximumDocumentationBytes,
} from "./documentation";
import { digestManifest, inlineText, manifestSchema, urlDocument } from "./manifest";
import {
  checkIdSchema,
  checkIds,
  checkResultSchema,
  deriveOutcome,
  outcomeSchema,
  type CheckId,
} from "./outcome";
import { redact } from "./redact";
import { cliVersion, schemaVersion } from "./version";

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

const runIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a safe run identifier without path separators.");

const manifestRunPrefixSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use a valid manifest identifier.");

const evidenceIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use a safe evidence identifier without path separators.");

const artifactNameSchema = z.enum(["AGENT_INSTRUCTIONS.md", "AX.md", "results.json"]);
const fileSystemErrorSchema = z.object({ code: z.string() }).loose();
const executionMetadataSchema = z
  .object({
    cliVersion: z.string().min(1),
    schemaVersion: z.literal(schemaVersion),
    runtime: z
      .object({
        nodeVersion: z.string().min(1),
        platform: z.string().min(1),
        release: z.string().min(1),
        arch: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const baseRunRecordSchema = z
  .object({
    runId: runIdSchema,
    manifest: manifestSchema,
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    workspace: z.string().min(1),
    preparation: executionMetadataSchema,
    documentation: z.array(documentationProvenanceSchema),
    baselineRevision: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/)
      .optional(),
    preparedAt: z.iso.datetime(),
  })
  .strict();

const verificationSchema = z
  .object({
    verifier: executionMetadataSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    outcome: outcomeSchema,
    results: z.array(checkResultSchema),
    omittedChecks: z
      .array(z.object({ id: checkIdSchema, reason: z.string().min(1) }).strict())
      .default([]),
    ungradedObservations: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((verification, context) => {
    const ids = verification.results.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "Verification results must contain each check at most once.",
      });
    }
    const omittedIds = verification.omittedChecks.map((entry) => entry.id);
    if (new Set(omittedIds).size !== omittedIds.length) {
      context.addIssue({
        code: "custom",
        path: ["omittedChecks"],
        message: "Each check can be omitted at most once.",
      });
    }
    if (omittedIds.some((id) => ids.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["omittedChecks"],
        message: "A check cannot be both omitted and evaluated.",
      });
    }
    const applicableChecks = checkIds.filter((id) => !omittedIds.includes(id));
    if (verification.outcome !== deriveOutcome(verification.results, applicableChecks)) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Verification outcome does not match its check results.",
      });
    }
    for (const [index, entry] of verification.results.entries()) {
      if (entry.evidenceIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "evidenceIds"],
          message: "Every check result must reference evidence.",
        });
      }
    }
    if (Date.parse(verification.completedAt) < Date.parse(verification.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Verification cannot complete before it starts.",
      });
    }
  });

export const runRecordSchema = z
  .discriminatedUnion("status", [
    baseRunRecordSchema.extend({ status: z.literal("prepared") }).strict(),
    baseRunRecordSchema
      .extend({ status: z.literal("verified"), verification: verificationSchema })
      .strict(),
  ])
  .superRefine((record, context) => {
    if (!record.runId.startsWith(`${record.manifest.id}-`)) {
      context.addIssue({
        code: "custom",
        path: ["runId"],
        message: "Run identifier does not match the manifest identifier.",
      });
    }
    if (record.documentation.length !== record.manifest.docs.length) {
      context.addIssue({
        code: "custom",
        path: ["documentation"],
        message: "Documentation provenance must match every manifest document.",
      });
    }
    const files = record.documentation.flatMap((entry) =>
      entry.status === "frozen" ? [entry.file] : [],
    );
    if (new Set(files).size !== files.length) {
      context.addIssue({
        code: "custom",
        path: ["documentation"],
        message: "Documentation snapshot files must be unique.",
      });
    }
    for (const [index, entry] of record.documentation.entries()) {
      const doc = record.manifest.docs[index];
      if (doc === undefined) continue;
      const inline = inlineText(doc);
      const url = urlDocument(doc);
      const expectedType = inline ? "inline" : "url";
      const expectedLabel = inline?.label ?? url?.label;
      const expectedUrl = url?.url;
      if (
        entry.sourceType !== expectedType ||
        entry.label !== expectedLabel ||
        (entry.sourceType === "url" && entry.sourceUrl !== expectedUrl)
      ) {
        context.addIssue({
          code: "custom",
          path: ["documentation", index],
          message: "Documentation provenance does not match the manifest source.",
        });
      }
    }
    if (record.status === "verified") {
      const expectedOmissions: CheckId[] = record.manifest.run.build ? [] : ["build"];
      const actualOmissions = record.verification.omittedChecks.map((entry) => entry.id);
      if (
        expectedOmissions.length !== actualOmissions.length ||
        expectedOmissions.some((id) => !actualOmissions.includes(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["verification", "omittedChecks"],
          message: "Omitted checks do not match the lifecycle declared by the manifest.",
        });
      }
    }
    if (
      record.status === "verified" &&
      Date.parse(record.verification.startedAt) < Date.parse(record.preparedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification", "startedAt"],
        message: "Verification cannot start before preparation.",
      });
    }
  });

export type RunRecord = z.infer<typeof runRecordSchema>;
export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>;
export type PreparedRunRecord = Extract<RunRecord, { status: "prepared" }>;
export type RunLocation = Readonly<{ runId: string; directory: string }>;
export type ArtifactName = "AGENT_INSTRUCTIONS.md" | "AX.md" | "results.json";
const verificationSessionToken = Symbol("verification-session");
export type VerificationSession = Readonly<{ [verificationSessionToken]: string }>;

export function runDirectory(runId: string): string {
  return join(runsRoot(), runIdSchema.parse(runId));
}

export function createRunId(manifestId: string, date = new Date()): string {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "-")
    .replace("Z", "")
    .replace("T", "-");
  return `${manifestRunPrefixSchema.parse(manifestId)}-${stamp}`;
}

export function currentRunMetadata(): ExecutionMetadata {
  return {
    cliVersion,
    schemaVersion,
    runtime: {
      nodeVersion: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
    },
  };
}

export async function reserveRunDirectory(
  manifestId: string,
  date = new Date(),
): Promise<RunLocation> {
  const root = runsRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const baseId = createRunId(manifestId, date);
  const staging = join(root, `.preparing-${baseId}-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  await writeFile(join(staging, ".preparing"), `${process.pid}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    for (let suffix = 0; ; suffix += 1) {
      const runId = suffix === 0 ? baseId : `${baseId}-${suffix}`;
      const directory = runDirectory(runId);
      try {
        await rename(staging, directory);
        return { runId, directory };
      } catch (error) {
        const parsedError = fileSystemErrorSchema.safeParse(error);
        if (
          parsedError.success &&
          (parsedError.data.code === "EEXIST" || parsedError.data.code === "ENOTEMPTY")
        ) {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function removeRunReservation(location: RunLocation): Promise<void> {
  await assertLocationIdentity(location);
  await rm(location.directory, { recursive: true, force: true });
}

export async function writeRunRecord(
  location: RunLocation,
  record: RunRecord,
  session?: VerificationSession,
): Promise<string> {
  await assertLocationIdentity(location);
  const parsed = runRecordSchema.parse(record);
  if (parsed.runId !== location.runId) throw new Error("Run record does not match its directory.");
  if (digestManifest(parsed.manifest) !== parsed.manifestDigest) {
    throw new Error("Run record manifest does not match its stored digest.");
  }
  await validateDocumentationSnapshots(location, parsed);
  const path = join(location.directory, "run.json");
  if (parsed.status === "prepared") {
    if (await pathExists(path)) throw new Error(`Run ${parsed.runId} already has a record.`);
    await exclusiveAtomicWriteFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
    await rm(join(location.directory, ".preparing"), { force: true });
  } else {
    await assertVerificationSession(location, session);
    const commitPath = join(location.directory, ".commit.lock");
    let commit;
    try {
      commit = await open(commitPath, "wx", 0o600);
    } catch (error) {
      const parsedError = fileSystemErrorSchema.safeParse(error);
      if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
      throw new Error(`Run ${parsed.runId} is already committing verification results.`);
    }
    try {
      await waitForVerificationWrites(location);
      await assertPreparedForCommit(location, session);
      await validateEvidenceReferences(location, parsed);
      await atomicWriteFile(path, `${JSON.stringify(parsed, null, 2)}\n`, () =>
        assertPreparedForCommit(location, session),
      );
    } finally {
      await commit.close().catch(() => undefined);
      await rm(commitPath, { force: true }).catch(() => undefined);
    }
  }
  return path;
}

export async function readRunRecord(runIdOrPath: string): Promise<RunRecord> {
  return (await loadRun(runIdOrPath)).record;
}

export async function loadRun(
  runIdOrPath: string,
): Promise<{ location: RunLocation; record: RunRecord }> {
  const location = await resolveRunLocation(runIdOrPath);
  return { location, record: await readRunRecordAt(location) };
}

async function readRunRecordAt(location: RunLocation): Promise<RunRecord> {
  const path = join(location.directory, "run.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "ENOENT") throw error;
    throw new Error(`No run record at ${path}. Run \`docs-trials prepare\` first.`);
  }
  let record: RunRecord;
  try {
    record = runRecordSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new Error(`Invalid run record at ${path}.`, { cause });
  }
  if (digestManifest(record.manifest) !== record.manifestDigest) {
    throw new Error(`The manifest digest does not match the manifest in ${path}.`);
  }
  await validateDocumentationSnapshots(location, record);
  if (record.runId !== location.runId) {
    throw new Error(`Invalid run record: ${path} declares run id ${record.runId}.`);
  }
  if (record.status === "verified") await validateEvidenceReferences(location, record);
  return record;
}

/** Accepts a run id, a run directory, or `latest`. */
export async function resolveRunDirectory(runIdOrPath: string): Promise<string> {
  return (await resolveRunLocation(runIdOrPath)).directory;
}

export async function resolveRunLocation(runIdOrPath: string): Promise<RunLocation> {
  if (runIdOrPath === "latest") {
    const latest = await latestRunId();
    if (!latest) throw new Error(`No runs found under ${runsRoot()}.`);
    return resolveRunLocation(latest);
  }
  const root = resolve(runsRoot());
  const isPath = runIdOrPath.includes("/") || runIdOrPath.includes("\\") || isAbsolute(runIdOrPath);
  const candidate = isPath ? resolve(runIdOrPath) : runDirectory(runIdOrPath);
  const candidateName = basename(candidate);
  if (candidate !== join(root, candidateName)) {
    throw new Error(`Run directory must be a direct child of ${root}.`);
  }
  const runId = runIdSchema.parse(candidateName);
  let rootReal: string;
  let candidateReal: string;
  try {
    [rootReal, candidateReal] = await Promise.all([realpath(root), realpath(candidate)]);
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "ENOENT") throw error;
    throw new Error(`No run directory at ${candidate}. Run \`docs-trials prepare\` first.`);
  }
  const stats = await lstat(candidate);
  if (!stats.isDirectory() || stats.isSymbolicLink() || dirname(candidateReal) !== rootReal) {
    throw new Error(`Run directory must be a real direct child of ${root}.`);
  }
  return { runId, directory: candidate };
}

export async function latestRunId(): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(runsRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".preparing-"))
      .map((entry) => entry.name);
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "ENOENT") throw error;
    return undefined;
  }
  let latest: RunRecord | undefined;
  let latestPreparedAt = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const runId = runIdSchema.parse(entry);
    const location = { runId, directory: runDirectory(runId) };
    if (
      !(await pathExists(join(location.directory, "run.json"))) &&
      (await pathExists(join(location.directory, ".preparing")))
    ) {
      continue;
    }
    const record = await readRunRecordAt(location);
    const preparedAt = Date.parse(record.preparedAt);
    if (
      !latest ||
      preparedAt > latestPreparedAt ||
      (preparedAt === latestPreparedAt && record.runId > latest.runId)
    ) {
      latest = record;
      latestPreparedAt = preparedAt;
    }
  }
  return latest?.runId;
}

export async function writeEvidence(
  location: RunLocation,
  id: string,
  content: string,
  session?: VerificationSession,
): Promise<string> {
  await assertLocationIdentity(location);
  const safeId = evidenceIdSchema.parse(id);
  return withVerificationWrite(location, session, async () => {
    const directory = join(location.directory, "evidence");
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      const parsedError = fileSystemErrorSchema.safeParse(error);
      if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Evidence path is not a real directory: ${directory}.`);
      }
    }
    const path = join(directory, `${safeId}.txt`);
    await atomicWriteFile(path, redact(content));
    return path;
  });
}

export async function writeDocumentationSnapshot(
  location: RunLocation,
  relativeFile: string,
  content: Uint8Array,
): Promise<string> {
  await assertLocationIdentity(location);
  if (content.byteLength > maximumDocumentationBytes) {
    throw new Error(`Documentation exceeds the ${maximumDocumentationBytes}-byte snapshot limit.`);
  }
  const safeFile = documentationFileSchema.parse(relativeFile);
  const directory = join(location.directory, "documentation");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Documentation path is not a real directory: ${directory}.`);
    }
  }
  const path = join(location.directory, safeFile);
  await exclusiveAtomicWriteFile(path, content);
  return path;
}

export async function writeArtifact(
  location: RunLocation,
  name: ArtifactName,
  content: string,
  session?: VerificationSession,
): Promise<string> {
  await assertLocationIdentity(location);
  return withVerificationWrite(location, session, async () => {
    const path = join(location.directory, artifactNameSchema.parse(name));
    await atomicWriteFile(path, content);
    return path;
  });
}

export async function withVerificationLock<T>(
  runIdOrPath: string,
  operation: (
    location: RunLocation,
    record: PreparedRunRecord,
    session: VerificationSession,
  ) => Promise<T>,
): Promise<T> {
  const location = await resolveRunLocation(runIdOrPath);
  const lockPath = join(location.directory, ".verify.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
    throw new Error(
      `Run ${location.runId} is already being verified. If no verification process remains, remove ${lockPath}.`,
    );
  }
  const session: VerificationSession = { [verificationSessionToken]: randomUUID() };
  try {
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: session[verificationSessionToken],
      })}\n`,
    );
    const record = await readRunRecordAt(location);
    if (record.status === "verified") {
      throw new Error(`Run ${record.runId} is already verified and cannot be overwritten.`);
    }
    return await operation(location, record, session);
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function validateEvidenceReferences(
  location: RunLocation,
  record: Extract<RunRecord, { status: "verified" }>,
): Promise<void> {
  const references = new Set(record.verification.results.flatMap((entry) => entry.evidenceIds));
  for (const id of references) {
    const safeId = evidenceIdSchema.parse(id);
    const path = join(location.directory, "evidence", `${safeId}.txt`);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      const parsedError = fileSystemErrorSchema.safeParse(error);
      if (!parsedError.success || parsedError.data.code !== "ENOENT") throw error;
      throw new Error(`Verified run ${record.runId} references missing evidence ${safeId}.`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Verified run ${record.runId} references invalid evidence ${safeId}.`);
    }
  }
}

async function validateDocumentationSnapshots(
  location: RunLocation,
  record: RunRecord,
): Promise<void> {
  const documentationDirectory = join(location.directory, "documentation");
  if (record.documentation.some((entry) => entry.status === "frozen")) {
    const directoryStats = await lstat(documentationDirectory);
    const [runReal, directoryReal] = await Promise.all([
      realpath(location.directory),
      realpath(documentationDirectory),
    ]);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      dirname(directoryReal) !== runReal
    ) {
      throw new Error(`Documentation path is not confined to run ${record.runId}.`);
    }
  }
  for (const entry of record.documentation) {
    if (entry.status !== "frozen") continue;
    const safeFile = documentationFileSchema.parse(entry.file);
    const path = join(location.directory, safeFile);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      const parsedError = fileSystemErrorSchema.safeParse(error);
      if (!parsedError.success || parsedError.data.code !== "ENOENT") throw error;
      throw new Error(`Run ${record.runId} references missing documentation snapshot ${safeFile}.`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Run ${record.runId} references invalid documentation snapshot ${safeFile}.`);
    }
    const [directoryReal, fileReal] = await Promise.all([
      realpath(documentationDirectory),
      realpath(path),
    ]);
    if (dirname(fileReal) !== directoryReal) {
      throw new Error(`Documentation snapshot must be confined to ${documentationDirectory}.`);
    }
    const observed = await digestDocumentationFile(path);
    if (observed.byteLength !== entry.byteLength) {
      throw new Error(`Documentation snapshot byte length does not match ${safeFile}.`);
    }
    if (observed.sha256 !== entry.sha256) {
      throw new Error(`Documentation snapshot digest does not match ${safeFile}.`);
    }
  }
}

async function digestDocumentationFile(
  path: string,
): Promise<{ sha256: string; byteLength: number }> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  let byteLength = 0;
  try {
    for await (const chunk of stream) {
      byteLength += chunk.byteLength;
      if (byteLength > maximumDocumentationBytes) {
        throw new Error(
          `Documentation snapshot exceeds the ${maximumDocumentationBytes}-byte limit.`,
        );
      }
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return { sha256: hash.digest("hex"), byteLength };
}

async function atomicWriteFile(
  path: string,
  content: string | Uint8Array,
  beforeCommit: () => Promise<void> = async () => {},
): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await beforeCommit();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function exclusiveAtomicWriteFile(path: string, content: string | Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function assertLocationIdentity(location: RunLocation): Promise<void> {
  if (runDirectory(location.runId) !== location.directory) {
    throw new Error("Run location does not match the configured run root.");
  }
  const resolved = await resolveRunLocation(location.directory);
  if (resolved.runId !== location.runId || resolved.directory !== location.directory) {
    throw new Error("Run location does not match its resolved directory.");
  }
}

async function withVerificationWrite<T>(
  location: RunLocation,
  session: VerificationSession | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const path = join(location.directory, "run.json");
  if (!(await pathExists(path))) return operation();
  const initialRecord = await readRunRecordAt(location);
  if (initialRecord.status !== "prepared") {
    throw new Error(`Run ${initialRecord.runId} is already verified and cannot be overwritten.`);
  }
  await assertVerificationSession(location, session);
  const leasePath = join(location.directory, `.write-${randomUUID()}`);
  const lease = await open(leasePath, "wx", 0o600);
  await lease.close();
  try {
    if (await pathExists(join(location.directory, ".commit.lock"))) {
      throw new Error(`Run ${location.runId} is committing verification results.`);
    }
    const currentRecord = await readRunRecordAt(location);
    if (currentRecord.status !== "prepared") {
      throw new Error(`Run ${currentRecord.runId} is already verified and cannot be overwritten.`);
    }
    return await operation();
  } finally {
    await rm(leasePath, { force: true }).catch(() => undefined);
  }
}

async function assertPreparedForCommit(
  location: RunLocation,
  session: VerificationSession | undefined,
): Promise<void> {
  await assertVerificationSession(location, session);
  const record = await readRunRecordAt(location);
  if (record.status !== "prepared") {
    throw new Error(`Run ${record.runId} is already verified and cannot be overwritten.`);
  }
}

async function assertVerificationSession(
  location: RunLocation,
  session: VerificationSession | undefined,
): Promise<void> {
  if (!session) throw new Error(`Run ${location.runId} requires its active verification session.`);
  const lockSchema = z.object({ token: z.string().uuid() }).loose();
  let lock;
  try {
    lock = lockSchema.parse(
      JSON.parse(await readFile(join(location.directory, ".verify.lock"), "utf8")),
    );
  } catch {
    throw new Error(`Run ${location.runId} no longer owns its verification lock.`);
  }
  if (lock.token !== session[verificationSessionToken]) {
    throw new Error(`Run ${location.runId} no longer owns its verification lock.`);
  }
}

async function waitForVerificationWrites(location: RunLocation): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const entries = await readdir(location.directory);
    if (!entries.some((entry) => entry.startsWith(".write-"))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timed out waiting for verification writes for run ${location.runId}.`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (parsedError.success && parsedError.data.code === "ENOENT") return false;
    throw error;
  }
}
