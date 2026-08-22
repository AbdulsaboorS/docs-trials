import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, homedir, hostname, platform, release } from "node:os";
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
  ungradedObservationSchema,
  type CheckId,
} from "./outcome";
import { redact } from "./redact";
import { cliVersion, schemaVersion } from "./version";
import { interruptWasRequested, trackInterruptCleanup } from "../util/process";

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
const verificationReleaseTimeoutMs = 30_000;
const managedLockSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["verify", "commit", "write", "recover"]),
    pid: z.number().int().positive().safe(),
    hostname: z.string().min(1).max(255),
    createdAt: z.iso.datetime(),
    token: z.string().uuid(),
    verificationToken: z.string().uuid(),
  })
  .strict();
const legacyVerificationLockSchema = z
  .object({
    pid: z.number().int().positive().safe(),
    createdAt: z.iso.datetime(),
    token: z.string().uuid(),
  })
  .strict();
type ManagedLock = z.infer<typeof managedLockSchema>;
type ProcessStatus = "alive" | "absent" | "unknown";
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
    ungradedObservations: z.array(ungradedObservationSchema).optional(),
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
    assertNotInterrupting();
    await assertVerificationSession(location, session);
    assertNotInterrupting();
    const commitPath = join(location.directory, ".commit.lock");
    const commitToken = randomUUID();
    const sessionToken = requireVerificationToken(location, session);
    const commitLock = createManagedLock(
      commitPath,
      lockMetadata("commit", commitToken, sessionToken),
    );
    let commitWork: Promise<void> | undefined;
    const untrackCommit = trackInterruptCleanup(async () => {
      await commitLock.catch(() => undefined);
      await commitWork?.catch(() => undefined);
      await removeOwnedLock(commitPath, commitToken);
    });
    try {
      await commitLock;
    } catch (error) {
      await removeOwnedLock(commitPath, commitToken);
      untrackCommit();
      const parsedError = fileSystemErrorSchema.safeParse(error);
      if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
      throw new Error(
        `Run ${parsed.runId} is already committing verification results. If its verifier stopped, run \`docs-trials recover ${parsed.runId}\`.`,
      );
    }
    try {
      assertNotInterrupting();
      commitWork = (async () => {
        await waitForVerificationWrites(location);
        await assertPreparedForCommit(location, session);
        await validateEvidenceReferences(location, parsed);
        await atomicWriteFile(path, `${JSON.stringify(parsed, null, 2)}\n`, () =>
          assertPreparedForCommit(location, session),
        );
      })();
      await commitWork;
    } finally {
      await removeOwnedLock(commitPath, commitToken);
      untrackCommit();
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

export async function resetVerificationOutputs(
  location: RunLocation,
  session: VerificationSession,
): Promise<void> {
  await assertLocationIdentity(location);
  await withVerificationWrite(location, session, async () => {
    await Promise.all([
      rm(join(location.directory, "evidence"), { recursive: true, force: true }),
      rm(join(location.directory, "AX.md"), { force: true }),
      rm(join(location.directory, "results.json"), { force: true }),
    ]);
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
  const recoveryPath = join(location.directory, ".recover.lock");
  if (await pathExists(recoveryPath)) {
    throw new Error(`Run ${location.runId} is being recovered. Try verification again.`);
  }
  const session: VerificationSession = { [verificationSessionToken]: randomUUID() };
  const verificationToken = session[verificationSessionToken];
  const verificationLock = createManagedLock(
    lockPath,
    lockMetadata("verify", verificationToken, verificationToken),
  );
  const untrackLock = trackInterruptCleanup(async () => {
    await verificationLock.catch(() => undefined);
    await removeVerificationLock(location, verificationToken);
  }, "owner");
  try {
    await verificationLock;
  } catch (error) {
    await removeVerificationLock(location, verificationToken);
    untrackLock();
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
    throw new Error(
      `Run ${location.runId} is already being verified. If its verifier stopped, run \`docs-trials recover ${location.runId}\`.`,
    );
  }
  try {
    assertNotInterrupting();
    if (await pathExists(recoveryPath)) {
      throw new Error(`Run ${location.runId} is being recovered. Try verification again.`);
    }
    const record = await readRunRecordAt(location);
    if (record.status === "verified") {
      throw new Error(`Run ${record.runId} is already verified and cannot be overwritten.`);
    }
    return await operation(location, record, session);
  } finally {
    await removeVerificationLock(location, verificationToken);
    untrackLock();
  }
}

async function validateEvidenceReferences(
  location: RunLocation,
  record: Extract<RunRecord, { status: "verified" }>,
): Promise<void> {
  const references = new Set([
    ...record.verification.results.flatMap((entry) => entry.evidenceIds),
    ...(record.verification.ungradedObservations ?? []).flatMap((entry) => entry.evidenceIds),
  ]);
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
  const evidenceDirectory = join(location.directory, "evidence");
  let entries: Dirent[];
  try {
    entries = await readdir(evidenceDirectory, { withFileTypes: true });
  } catch (error) {
    const parsed = fileSystemErrorSchema.safeParse(error);
    if (!parsed.success || parsed.data.code !== "ENOENT") throw error;
    entries = [];
  }
  const expectedFiles = new Set([...references].map((id) => `${id}.txt`));
  if (
    entries.length !== expectedFiles.size ||
    entries.some((entry) => !entry.isFile() || !expectedFiles.has(entry.name))
  ) {
    throw new Error(`Verified run ${record.runId} contains unreferenced evidence.`);
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
  assertNotInterrupting();
  const path = join(location.directory, "run.json");
  if (!(await pathExists(path))) return operation();
  const initialRecord = await readRunRecordAt(location);
  if (initialRecord.status !== "prepared") {
    throw new Error(`Run ${initialRecord.runId} is already verified and cannot be overwritten.`);
  }
  await assertVerificationSession(location, session);
  assertNotInterrupting();
  const sessionToken = requireVerificationToken(location, session);
  const leasePath = join(location.directory, `.write-${randomUUID()}`);
  const leaseToken = randomUUID();
  const leaseLock = createManagedLock(leasePath, lockMetadata("write", leaseToken, sessionToken));
  let activeWrite: Promise<T> | undefined;
  const untrackLease = trackInterruptCleanup(async () => {
    await leaseLock.catch(() => undefined);
    await activeWrite?.catch(() => undefined);
    await removeOwnedLock(leasePath, leaseToken);
  });
  try {
    await leaseLock;
    assertNotInterrupting();
    if (await pathExists(join(location.directory, ".commit.lock"))) {
      throw new Error(`Run ${location.runId} is committing verification results.`);
    }
    const currentRecord = await readRunRecordAt(location);
    if (currentRecord.status !== "prepared") {
      throw new Error(`Run ${currentRecord.runId} is already verified and cannot be overwritten.`);
    }
    activeWrite = operation();
    return await activeWrite;
  } finally {
    await removeOwnedLock(leasePath, leaseToken);
    untrackLease();
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
  let lock;
  try {
    const value: unknown = JSON.parse(
      await readFile(join(location.directory, ".verify.lock"), "utf8"),
    );
    lock = z.union([managedLockSchema, legacyVerificationLockSchema]).parse(value);
  } catch {
    throw new Error(`Run ${location.runId} no longer owns its verification lock.`);
  }
  if (
    ("kind" in lock && lock.kind !== "verify") ||
    lock.token !== session[verificationSessionToken]
  ) {
    throw new Error(`Run ${location.runId} no longer owns its verification lock.`);
  }
}

export type RecoveryResult = { runId: string; removed: string[] };

/** Removes only run locks whose recorded local process is demonstrably absent. */
export async function recoverRunLocks(
  runIdOrPath: string,
  processStatus: (pid: number) => ProcessStatus = localProcessStatus,
  force = false,
): Promise<RecoveryResult> {
  const location = await resolveRunLocation(runIdOrPath);
  const recoveryPath = join(location.directory, ".recover.lock");
  const recoveryToken = randomUUID();
  const recoveryLock = acquireRecoveryLock(location, recoveryToken, processStatus, force);
  const untrackRecovery = trackInterruptCleanup(async () => {
    await recoveryLock.catch(() => undefined);
    await removeOwnedLock(recoveryPath, recoveryToken);
  }, "owner");
  try {
    await recoveryLock;
    assertNotInterrupting();
    return await recoverLockedRun(location, processStatus, force);
  } finally {
    await removeOwnedLock(recoveryPath, recoveryToken);
    untrackRecovery();
  }
}

async function recoverLockedRun(
  location: RunLocation,
  processStatus: (pid: number) => ProcessStatus,
  force: boolean,
): Promise<RecoveryResult> {
  const entries = await readdir(location.directory);
  const names = entries
    .filter(
      (entry) =>
        entry === ".verify.lock" || entry === ".commit.lock" || entry.startsWith(".write-"),
    )
    .sort();
  if (names.length === 0) return { runId: location.runId, removed: [] };

  const locks = new Map<string, ManagedLock | { exact: string }>();
  let verification: ManagedLock | z.infer<typeof legacyVerificationLockSchema> | undefined;
  let unverifiableVerification: string | undefined;
  if (names.includes(".verify.lock")) {
    const raw = await readLockText(join(location.directory, ".verify.lock"));
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    const parsed = z.union([managedLockSchema, legacyVerificationLockSchema]).safeParse(value);
    if (!parsed.success) {
      if (!force) throw recoveryRefusal(location, ".verify.lock is malformed");
      unverifiableVerification = raw;
    } else if ("kind" in parsed.data && parsed.data.kind !== "verify") {
      if (!force) throw recoveryRefusal(location, ".verify.lock has the wrong lock kind");
      unverifiableVerification = raw;
    } else {
      verification = parsed.data;
    }
  }

  for (const name of names) {
    if (name === ".verify.lock") continue;
    const path = join(location.directory, name);
    const raw = await readLockText(path);
    if (raw === "") {
      if ((!verification || "kind" in verification) && !force) {
        throw recoveryRefusal(location, `${name} has no ownership metadata`);
      }
      locks.set(name, { exact: raw });
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    const parsed = managedLockSchema.safeParse(value);
    if (!parsed.success) {
      if (!force) throw recoveryRefusal(location, `${name} is malformed`);
      locks.set(name, { exact: raw });
      continue;
    }
    const expectedKind = name === ".commit.lock" ? "commit" : "write";
    if (parsed.data.kind !== expectedKind) {
      if (!force) throw recoveryRefusal(location, `${name} has the wrong lock kind`);
      locks.set(name, { exact: raw });
      continue;
    }
    if (verification && parsed.data.verificationToken !== verification.token) {
      if (!force) {
        throw recoveryRefusal(location, `${name} does not belong to the verification lock`);
      }
      locks.set(name, { exact: raw });
      continue;
    }
    locks.set(name, parsed.data);
  }

  const owners = [
    ...(verification ? [verification] : []),
    ...[...locks.values()].filter((lock): lock is ManagedLock => !("exact" in lock)),
  ];
  for (const owner of owners) {
    if ("hostname" in owner && owner.hostname !== hostname()) {
      throw recoveryRefusal(location, `lock owner host ${owner.hostname} is not this host`);
    }
    const status = processStatus(owner.pid);
    if (status !== "absent") {
      throw recoveryRefusal(
        location,
        `process ${owner.pid} is ${status === "alive" ? "still running" : "not safely inspectable"}`,
      );
    }
  }

  const removed: string[] = [];
  for (const name of [...names.filter((entry) => entry !== ".verify.lock"), ".verify.lock"]) {
    if (!names.includes(name)) continue;
    const lock = locks.get(name);
    const path = join(location.directory, name);
    const removedLock =
      lock && !("exact" in lock)
        ? await takeOwnedLock(path, lock.token)
        : name === ".verify.lock" && verification
          ? await takeOwnedLock(path, verification.token)
          : await takeExactLock(
              path,
              name === ".verify.lock" ? (unverifiableVerification ?? "") : (lock?.exact ?? ""),
            );
    if (!removedLock) {
      throw new Error(
        `Recovery of run ${location.runId} stopped because ${name} changed. Previously removed locks: ${removed.join(", ") || "none"}.`,
      );
    }
    removed.push(name);
  }
  return { runId: location.runId, removed };
}

async function waitForVerificationWrites(location: RunLocation): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const entries = await readdir(location.directory);
    if (!entries.some((entry) => entry.startsWith(".write-"))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(
    `Timed out waiting for verification writes for run ${location.runId}. If its verifier stopped, run \`docs-trials recover ${location.runId}\`.`,
  );
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

function lockMetadata(kind: ManagedLock["kind"], token: string, verificationToken: string) {
  return managedLockSchema.parse({
    version: 1,
    kind,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    token,
    verificationToken,
  });
}

async function createManagedLock(path: string, metadata: ManagedLock): Promise<void> {
  await exclusiveAtomicWriteFile(path, `${JSON.stringify(metadata)}\n`);
}

async function readLockText(path: string): Promise<string> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 4_096) {
    throw new Error(`Lock path is not a bounded regular file: ${path}.`);
  }
  return readFile(path, "utf8");
}

async function removeOwnedLock(path: string, token: string): Promise<void> {
  if (!(await lockHasToken(path, token))) return;
  if (!(await takeOwnedLock(path, token))) {
    throw new Error(`Lock ownership changed while releasing ${path}.`);
  }
}

async function removeVerificationLock(location: RunLocation, token: string): Promise<void> {
  const recoveryPath = join(location.directory, ".recover.lock");
  const recoveryToken = randomUUID();
  const deadline = Date.now() + verificationReleaseTimeoutMs;
  for (;;) {
    try {
      await createManagedLock(recoveryPath, lockMetadata("recover", recoveryToken, recoveryToken));
      break;
    } catch (error) {
      const parsed = fileSystemErrorSchema.safeParse(error);
      if (!parsed.success || parsed.data.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out releasing verification ownership for run ${location.runId}. Run \`docs-trials recover ${location.runId}\` after the active recovery stops.`,
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  try {
    await removeOwnedLock(join(location.directory, ".verify.lock"), token);
  } finally {
    await removeOwnedLock(recoveryPath, recoveryToken);
  }
}

async function acquireRecoveryLock(
  location: RunLocation,
  token: string,
  processStatus: (pid: number) => ProcessStatus,
  force: boolean,
): Promise<void> {
  const path = join(location.directory, ".recover.lock");
  const metadata = lockMetadata("recover", token, token);
  try {
    await createManagedLock(path, metadata);
    return;
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (!parsedError.success || parsedError.data.code !== "EEXIST") throw error;
  }

  let raw: string;
  try {
    raw = await readLockText(path);
  } catch {
    throw new Error(`Run ${location.runId} has an invalid recovery lock.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const parsed = managedLockSchema.safeParse(value);
  const existing = parsed.success ? parsed.data : undefined;
  if (
    existing?.kind === "recover" &&
    existing.hostname === hostname() &&
    processStatus(existing.pid) === "absent"
  ) {
    if (!(await takeOwnedLock(path, existing.token))) {
      throw new Error(`Run ${location.runId} recovery ownership changed. Try again.`);
    }
  } else if (!existing || existing.kind !== "recover") {
    if (!force) throw new Error(`Run ${location.runId} has an invalid recovery lock.`);
    if (!(await takeExactLock(path, raw))) {
      throw new Error(`Run ${location.runId} recovery ownership changed. Try again.`);
    }
  } else {
    throw new Error(`Run ${location.runId} is already being recovered.`);
  }
  try {
    await createManagedLock(path, metadata);
  } catch (error) {
    const parsedError = fileSystemErrorSchema.safeParse(error);
    if (parsedError.success && parsedError.data.code === "EEXIST") {
      throw new Error(`Run ${location.runId} is already being recovered.`);
    }
    throw error;
  }
}

async function lockHasToken(path: string, token: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readLockText(path));
    const parsed = z.union([managedLockSchema, legacyVerificationLockSchema]).safeParse(value);
    return parsed.success && parsed.data.token === token;
  } catch {
    return false;
  }
}

async function takeOwnedLock(path: string, token: string): Promise<boolean> {
  const quarantine = join(dirname(path), `.${basename(path)}.take-${randomUUID()}`);
  try {
    await rename(path, quarantine);
  } catch (error) {
    const parsed = fileSystemErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.code === "ENOENT") return true;
    return false;
  }
  try {
    const value: unknown = JSON.parse(await readLockText(quarantine));
    const parsed = z.union([managedLockSchema, legacyVerificationLockSchema]).safeParse(value);
    if (parsed.success && parsed.data.token === token) {
      await rm(quarantine, { force: true });
      return true;
    }
  } catch {
    // A changed lock is restored below instead of being deleted.
  }
  try {
    await link(quarantine, path);
    await rm(quarantine, { force: true });
  } catch {
    // Preserve the quarantined file if another owner already recreated the path.
  }
  return false;
}

async function takeExactLock(path: string, expected: string): Promise<boolean> {
  const quarantine = join(dirname(path), `.${basename(path)}.take-${randomUUID()}`);
  try {
    await rename(path, quarantine);
  } catch {
    return false;
  }
  try {
    if ((await readLockText(quarantine)) === expected) {
      await rm(quarantine, { force: true });
      return true;
    }
  } catch {
    // A changed lock is restored below instead of being deleted.
  }
  try {
    await link(quarantine, path);
    await rm(quarantine, { force: true });
  } catch {
    // Preserve the quarantined file if another owner already recreated the path.
  }
  return false;
}

function requireVerificationToken(
  location: RunLocation,
  session: VerificationSession | undefined,
): string {
  if (!session) throw new Error(`Run ${location.runId} requires its active verification session.`);
  return session[verificationSessionToken];
}

function assertNotInterrupting(): void {
  if (interruptWasRequested()) throw new Error("Docs Trials was interrupted.");
}

function localProcessStatus(pid: number): ProcessStatus {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const parsed = fileSystemErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.code === "ESRCH") return "absent";
    return "unknown";
  }
}

function recoveryRefusal(location: RunLocation, detail: string): Error {
  return new Error(`Cannot recover run ${location.runId}: ${detail}. No lock was removed.`);
}
