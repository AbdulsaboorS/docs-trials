import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { digestDocumentation, maximumDocumentationBytes } from "../src/core/documentation";
import { digestManifest, manifestSchema } from "../src/core/manifest";
import { result } from "../src/core/outcome";
import {
  recoverRunLocks,
  latestRunId,
  readRunRecord,
  reserveRunDirectory,
  withVerificationLock,
  writeArtifact,
  currentRunMetadata,
  writeDocumentationSnapshot,
  writeEvidence,
  writeRunRecord,
  type RunLocation,
  type RunRecord,
} from "../src/core/run";

let home: string;

type RawRunRecord = {
  runId: string;
  status: string;
  manifest: RunRecord["manifest"];
  manifestDigest: string;
  workspace: string;
  preparedAt: string;
  baselineRevision?: string | undefined;
  preparation: RunRecord["preparation"];
  documentation: RunRecord["documentation"];
  verification?: {
    verifier?: RunRecord["preparation"];
    startedAt: string;
    completedAt: string;
    outcome: string;
    results: Array<{
      id?: string | undefined;
      title?: string | undefined;
      outcome?: string | undefined;
      detail?: string | undefined;
      evidenceIds?: string[] | undefined;
    }>;
    omittedChecks?: Array<{ id: string; reason: string }>;
    ungradedObservations?: Array<{ detail: string; evidenceIds: string[] }>;
  };
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "docs-trials-runs-"));
  vi.stubEnv("DOCS_TRIALS_HOME", home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

function record(runId: string, manifestId: string, preparedAt: string): RunRecord {
  const manifest = manifestSchema.parse({
    version: 1,
    id: manifestId,
    title: "Sample",
    task: "Build something.",
    docs: ["https://example.com/docs"],
    run: { start: "node server.mjs" },
  });
  return {
    runId,
    status: "prepared",
    manifest,
    manifestDigest: digestManifest(manifest),
    workspace: "/tmp/workspace",
    preparedAt,
    preparation: currentRunMetadata(),
    documentation: [
      {
        status: "live",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        retrievedAt: preparedAt,
        error: "Test fixture did not retrieve documentation.",
      },
    ],
  };
}

async function store(expected: RunRecord): Promise<{ location: RunLocation; path: string }> {
  const location = { runId: expected.runId, directory: join(home, expected.runId) };
  await mkdir(location.directory);
  return { location, path: await writeRunRecord(location, expected) };
}

async function writeRaw(expected: RawRunRecord): Promise<RunLocation> {
  const runId = z.object({ runId: z.string() }).loose().parse(expected).runId;
  const location = { runId, directory: join(home, runId) };
  await mkdir(location.directory);
  await writeFile(join(location.directory, "run.json"), `${JSON.stringify(expected, null, 2)}\n`);
  return location;
}

describe("run records", () => {
  it("reads a valid record by run id or its direct directory", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { path } = await store(expected);

    await expect(readRunRecord(expected.runId)).resolves.toEqual(expected);
    await expect(readRunRecord(dirname(path))).resolves.toEqual(expected);
  });

  it("rejects a manifest that does not match its stored digest", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { path } = await store(expected);
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw.replace("Build something.", "Build something else."));

    await expect(readRunRecord(expected.runId)).rejects.toThrow(/manifest digest does not match/i);
  });

  it("rejects changed and unsafe documentation snapshots", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const location = await reserveRunDirectory("sample", new Date(expected.preparedAt));
    expected.runId = location.runId;
    const content = new TextEncoder().encode("Frozen documentation");
    const file = "documentation/001-example.txt";
    expected.documentation = [
      {
        status: "frozen",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        finalUrl: "https://example.com/docs",
        retrievedAt: expected.preparedAt,
        httpStatus: 200,
        contentType: "text/plain",
        sha256: digestDocumentation(content),
        byteLength: content.byteLength,
        file,
      },
    ];
    await writeDocumentationSnapshot(location, file, content);
    await writeRunRecord(location, expected);
    await writeFile(join(location.directory, file), "Frozen documentatioN");

    await expect(readRunRecord(location.runId)).rejects.toThrow(/snapshot digest does not match/i);
    await expect(
      writeDocumentationSnapshot(location, "documentation/../../outside.txt", content),
    ).rejects.toThrow(/confined documentation snapshot path/i);
  });

  it("rejects a snapshot reached through a symlinked documentation directory", async () => {
    const expected = record("sample-symlink", "sample", "2026-08-20T12:00:00.000Z");
    const location = { runId: expected.runId, directory: join(home, expected.runId) };
    const outside = await mkdtemp(join(tmpdir(), "docs-trials-documentation-"));
    const content = new TextEncoder().encode("Outside documentation");
    const file = "documentation/001-example.txt";
    expected.documentation = [
      {
        status: "frozen",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        finalUrl: "https://example.com/docs",
        retrievedAt: expected.preparedAt,
        httpStatus: 200,
        contentType: "text/plain",
        sha256: digestDocumentation(content),
        byteLength: content.byteLength,
        file,
      },
    ];
    await mkdir(location.directory);
    await writeFile(join(outside, "001-example.txt"), content);
    await symlink(outside, join(location.directory, "documentation"));
    await writeFile(join(location.directory, "run.json"), `${JSON.stringify(expected)}\n`);
    try {
      await expect(readRunRecord(location.runId)).rejects.toThrow(/not confined/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("stops digest validation when a snapshot exceeds the byte limit", async () => {
    const expected = record("sample-oversized", "sample", "2026-08-20T12:00:00.000Z");
    const location = { runId: expected.runId, directory: join(home, expected.runId) };
    const content = new TextEncoder().encode("Original");
    const file = "documentation/001-example.txt";
    expected.documentation = [
      {
        status: "frozen",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        finalUrl: "https://example.com/docs",
        retrievedAt: expected.preparedAt,
        httpStatus: 200,
        contentType: "text/plain",
        sha256: digestDocumentation(content),
        byteLength: content.byteLength,
        file,
      },
    ];
    await mkdir(location.directory);
    await writeDocumentationSnapshot(location, file, content);
    await writeRunRecord(location, expected);
    await writeFile(join(location.directory, file), new Uint8Array(maximumDocumentationBytes + 1));

    await expect(readRunRecord(location.runId)).rejects.toThrow(/snapshot exceeds.*byte limit/i);
  });

  it("selects the newest preparation across different manifest ids", async () => {
    await store(record("zz-old-20260820-120000", "zz-old", "2026-08-20T12:00:00.000Z"));
    const newest = record("aa-new-20260820-120100", "aa-new", "2026-08-20T12:01:00.000Z");
    await store(newest);

    await expect(latestRunId()).resolves.toBe(newest.runId);
    await expect(readRunRecord("latest")).resolves.toEqual(newest);
  });

  it("uses the run id as a deterministic timestamp tie-break", async () => {
    const preparedAt = "2026-08-20T12:00:00.000Z";
    await store(record("aa-same-20260820-120000", "aa-same", preparedAt));
    await store(record("zz-same-20260820-120000", "zz-same", preparedAt));

    await expect(latestRunId()).resolves.toBe("zz-same-20260820-120000");
  });

  it("orders timestamps with different fractional precision chronologically", async () => {
    await store(record("whole-20260820-120000", "whole", "2026-08-20T12:00:00Z"));
    await store(record("fraction-20260820-120000", "fraction", "2026-08-20T12:00:00.100Z"));

    await expect(latestRunId()).resolves.toBe("fraction-20260820-120000");
  });

  it("surfaces a corrupt candidate instead of selecting an older valid run", async () => {
    await store(record("valid-20260820-120000", "valid", "2026-08-20T12:00:00.000Z"));
    const corruptDirectory = join(home, "corrupt-20260820-120100");
    await mkdir(corruptDirectory);
    await writeFile(join(corruptDirectory, "run.json"), "{}\n");

    await expect(latestRunId()).rejects.toThrow(/invalid run record/i);
  });

  it("ignores an exclusively reserved run that was never committed", async () => {
    const valid = record("valid-20260820-120000", "valid", "2026-08-20T12:00:00.000Z");
    await store(valid);
    await reserveRunDirectory("interrupted", new Date("2026-08-20T12:01:00.000Z"));

    await expect(latestRunId()).resolves.toBe(valid.runId);
  });

  it("reserves unique directories for concurrent same-time preparations", async () => {
    const when = new Date("2026-08-20T12:00:00.123Z");
    const locations = await Promise.all(
      Array.from({ length: 8 }, () => reserveRunDirectory("sample", when)),
    );

    expect(new Set(locations.map((entry) => entry.runId))).toHaveLength(8);
    expect(locations.map((entry) => entry.runId).sort()).toEqual([
      "sample-20260820-120000-123",
      "sample-20260820-120000-123-1",
      "sample-20260820-120000-123-2",
      "sample-20260820-120000-123-3",
      "sample-20260820-120000-123-4",
      "sample-20260820-120000-123-5",
      "sample-20260820-120000-123-6",
      "sample-20260820-120000-123-7",
    ]);
  });

  it("never overwrites an existing reservation", async () => {
    const when = new Date("2026-08-20T12:00:00.123Z");
    const first = await reserveRunDirectory("sample", when);
    const marker = join(first.directory, "marker.txt");
    await writeFile(marker, "original");

    const second = await reserveRunDirectory("sample", when);

    expect(second.runId).not.toBe(first.runId);
    await expect(readFile(marker, "utf8")).resolves.toBe("original");
  });

  it("does not overwrite an existing prepared record", async () => {
    const original = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(original);
    const before = await readFile(join(location.directory, "run.json"), "utf8");

    await expect(writeRunRecord(location, original)).rejects.toThrow(/already has a record/i);
    await expect(readFile(join(location.directory, "run.json"), "utf8")).resolves.toBe(before);
  });

  it("allows only one concurrent prepared record commit", async () => {
    const location = await reserveRunDirectory("sample", new Date("2026-08-20T12:00:00.000Z"));
    const expected = record(location.runId, "sample", "2026-08-20T12:00:00.000Z");

    const attempts = await Promise.allSettled([
      writeRunRecord(location, expected),
      writeRunRecord(location, expected),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    await expect(readRunRecord(location.runId)).resolves.toEqual(expected);
  });

  it("rejects traversal, nested, outside-root, and symlink run paths", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const outside = await mkdtemp(join(tmpdir(), "docs-trials-outside-"));
    const nested = join(home, "nested", expected.runId);
    await mkdir(nested, { recursive: true });
    const alias = join(home, "sample-alias");
    await symlink(location.directory, alias);
    try {
      await expect(readRunRecord(`../${expected.runId}`)).rejects.toThrow(/direct child/i);
      await expect(readRunRecord(outside)).rejects.toThrow(/direct child/i);
      await expect(readRunRecord(nested)).rejects.toThrow(/direct child/i);
      await expect(readRunRecord(alias)).rejects.toThrow(/real direct child/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a record whose run id does not match its directory", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const location = { runId: "sample-other", directory: join(home, "sample-other") };
    await mkdir(location.directory);
    await writeFile(join(location.directory, "run.json"), `${JSON.stringify(expected)}\n`);

    await expect(readRunRecord(location.runId)).rejects.toThrow(/declares run id/i);
  });

  it("rejects inconsistent verification outcomes, duplicate checks, and changed titles", async () => {
    const base = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const verification = {
      verifier: currentRunMetadata(),
      startedAt: "2026-08-20T12:01:00.000Z",
      completedAt: "2026-08-20T12:02:00.000Z",
      outcome: "inconclusive",
      results: [result("install", "passed", "ok")],
      omittedChecks: [{ id: "build", reason: "No build command." }],
    };

    const mismatched = await writeRaw({
      ...base,
      runId: "sample-outcome",
      status: "verified",
      verification: { ...verification, outcome: "passed" },
    });
    await expect(readRunRecord(mismatched.runId)).rejects.toThrow(/invalid run record/i);

    const duplicate = await writeRaw({
      ...base,
      runId: "sample-duplicate",
      status: "verified",
      verification: {
        ...verification,
        results: [...verification.results, ...verification.results],
      },
    });
    await expect(readRunRecord(duplicate.runId)).rejects.toThrow(/invalid run record/i);

    const changedTitle = await writeRaw({
      ...base,
      runId: "sample-title",
      status: "verified",
      verification: {
        ...verification,
        results: [{ ...verification.results[0], title: "Everything works." }],
      },
    });
    await expect(readRunRecord(changedTitle.runId)).rejects.toThrow(/invalid run record/i);
  });

  it("rejects status disagreements and missing evidence references", async () => {
    const base = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const preparedWithVerification = await writeRaw({
      ...base,
      runId: "sample-prepared-extra",
      verification: {
        verifier: currentRunMetadata(),
        startedAt: "2026-08-20T12:01:00.000Z",
        completedAt: "2026-08-20T12:02:00.000Z",
        outcome: "inconclusive",
        results: [],
        omittedChecks: [{ id: "build", reason: "No build command." }],
      },
    });
    await expect(readRunRecord(preparedWithVerification.runId)).rejects.toThrow(
      /invalid run record/i,
    );

    const missingEvidence = await writeRaw({
      ...base,
      runId: "sample-missing-evidence",
      status: "verified",
      verification: {
        verifier: currentRunMetadata(),
        startedAt: "2026-08-20T12:01:00.000Z",
        completedAt: "2026-08-20T12:02:00.000Z",
        outcome: "inconclusive",
        results: [result("install", "passed", "ok", ["install"])],
        omittedChecks: [{ id: "build", reason: "No build command." }],
      },
    });
    await expect(readRunRecord(missingEvidence.runId)).rejects.toThrow(/missing evidence install/i);
  });

  it("rejects an ungraded observation with missing evidence", async () => {
    const base = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const missingEvidence = await writeRaw({
      ...base,
      runId: "sample-ungraded-missing-evidence",
      status: "verified",
      verification: {
        verifier: currentRunMetadata(),
        startedAt: "2026-08-20T12:01:00.000Z",
        completedAt: "2026-08-20T12:02:00.000Z",
        outcome: "inconclusive",
        results: [result("install", "passed", "ok", ["install"])],
        omittedChecks: [{ id: "build", reason: "No build command." }],
        ungradedObservations: [{ detail: "Observed something.", evidenceIds: ["browser"] }],
      },
    });
    await mkdir(join(missingEvidence.directory, "evidence"));
    await writeFile(join(missingEvidence.directory, "evidence", "install.txt"), "observed\n");

    await expect(readRunRecord(missingEvidence.runId)).rejects.toThrow(/missing evidence browser/i);
  });

  it("rejects omissions that do not match the manifest lifecycle", async () => {
    const base = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const forged = await writeRaw({
      ...base,
      runId: "sample-forged-omissions",
      status: "verified",
      verification: {
        verifier: currentRunMetadata(),
        startedAt: "2026-08-20T12:01:00.000Z",
        completedAt: "2026-08-20T12:02:00.000Z",
        outcome: "passed",
        results: [result("install", "passed", "ok", ["install"])],
        omittedChecks: [
          "build",
          "boot",
          "page-load",
          "visible-content",
          "console-errors",
          "resource-loads",
          "server-errors",
          "client-secrets",
          "network-egress",
        ].map((id) => ({ id, reason: "Forged omission." })),
      },
    });

    await expect(readRunRecord(forged.runId)).rejects.toThrow(/invalid run record/i);
  });

  it("rejects unsafe generated evidence and artifact paths", async () => {
    const location = await reserveRunDirectory("sample");
    await expect(writeEvidence(location, "../outside", "x")).rejects.toThrow();
    // SAFETY: This bypasses the TypeScript allowlist to verify the runtime boundary.
    await expect(writeArtifact(location, "../outside" as "AX.md", "x")).rejects.toThrow();
  });
});

describe("verification locks", () => {
  it("allows only one verifier into a run", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    await store(expected);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const didEnter = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withVerificationLock(expected.runId, async () => {
      entered();
      await held;
    });
    await didEnter;

    await expect(withVerificationLock(expected.runId, async () => {})).rejects.toThrow(
      /already being verified/i,
    );
    release();
    await first;
  });

  it("releases its lock after an operation fails", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    await store(expected);

    await expect(
      withVerificationLock(expected.runId, async () => {
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow(/deliberate failure/);
    await expect(withVerificationLock(expected.runId, async () => "entered")).resolves.toBe(
      "entered",
    );
  });

  it("fails closed on an existing lock", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    await writeFile(join(location.directory, ".verify.lock"), "stale\n");

    await expect(withVerificationLock(expected.runId, async () => {})).rejects.toThrow(
      /docs-trials recover/i,
    );
  });

  it("does not acquire verification ownership during recovery", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const recoveryPath = join(location.directory, ".recover.lock");
    await writeFile(recoveryPath, "recovery in progress\n");

    await expect(withVerificationLock(expected.runId, async () => {})).rejects.toThrow(
      /being recovered/i,
    );
    await expect(readFile(join(location.directory, ".verify.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(recoveryPath);
  });

  it("releases verification ownership while a recovery lock is present", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const recoveryPath = join(location.directory, ".recover.lock");
    const recoveryContents = "recovery in progress\n";
    let releaseRecovery: Promise<void> | undefined;
    let recoveryReleased = false;

    await withVerificationLock(expected.runId, async () => {
      await writeFile(recoveryPath, recoveryContents);
      releaseRecovery = new Promise((resolveRelease) => {
        setTimeout(
          () =>
            void rm(recoveryPath).then(() => {
              recoveryReleased = true;
              resolveRelease();
            }),
          50,
        );
      });
    });

    expect(recoveryReleased).toBe(true);
    await releaseRecovery;
    await expect(readFile(join(location.directory, ".verify.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(withVerificationLock(expected.runId, async () => "entered")).resolves.toBe(
      "entered",
    );
  });

  it("recovers a dead legacy verifier and its write leases", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    await writeFile(
      join(location.directory, ".verify.lock"),
      `${JSON.stringify({
        pid: 999_999,
        createdAt: "2026-08-20T12:01:00.000Z",
        token: "00000000-0000-4000-8000-000000000001",
      })}\n`,
    );
    await writeFile(join(location.directory, ".commit.lock"), "");
    await writeFile(join(location.directory, ".write-legacy"), "");

    const recovered = await recoverRunLocks(expected.runId, () => "absent");

    expect(recovered.removed).toEqual([".commit.lock", ".write-legacy", ".verify.lock"]);
    await expect(readFile(join(location.directory, ".verify.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(location.directory, ".commit.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reclaims a recovery lock left by a dead process", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const recoveryPath = join(location.directory, ".recover.lock");
    await writeFile(
      recoveryPath,
      `${JSON.stringify({
        version: 1,
        kind: "recover",
        pid: 999_999,
        hostname: hostname(),
        createdAt: "2026-08-20T12:01:00.000Z",
        token: "00000000-0000-4000-8000-000000000003",
        verificationToken: "00000000-0000-4000-8000-000000000003",
      })}\n`,
    );

    await expect(recoverRunLocks(expected.runId, () => "absent")).resolves.toEqual({
      runId: expected.runId,
      removed: [],
    });
    await expect(readFile(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("force-reclaims a malformed recovery lock", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const recoveryPath = join(location.directory, ".recover.lock");
    await writeFile(recoveryPath, "stale\n");

    await expect(recoverRunLocks(expected.runId, () => "alive", true)).resolves.toEqual({
      runId: expected.runId,
      removed: [],
    });
    await expect(readFile(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses recovery while the recorded verifier may be alive", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const lockPath = join(location.directory, ".verify.lock");
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        createdAt: "2026-08-20T12:01:00.000Z",
        token: "00000000-0000-4000-8000-000000000002",
      })}\n`,
    );

    await expect(recoverRunLocks(expected.runId, () => "alive")).rejects.toThrow(
      /still running.*no lock was removed/i,
    );
    await expect(readFile(lockPath, "utf8")).resolves.toContain(String(process.pid));
  });

  it("refuses malformed recovery state without removing it", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const lockPath = join(location.directory, ".verify.lock");
    await writeFile(lockPath, "stale\n");

    await expect(recoverRunLocks(expected.runId, () => "absent")).rejects.toThrow(
      /malformed.*no lock was removed/i,
    );
    await expect(readFile(lockPath, "utf8")).resolves.toBe("stale\n");
  });

  it("force-recovers an unverifiable verification lock", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const lockPath = join(location.directory, ".verify.lock");
    await writeFile(lockPath, "stale\n");

    await expect(recoverRunLocks(expected.runId, () => "alive", true)).resolves.toEqual({
      runId: expected.runId,
      removed: [".verify.lock"],
    });
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not force-recover a valid lock whose owner may be alive", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const { location } = await store(expected);
    const lockPath = join(location.directory, ".verify.lock");
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        createdAt: "2026-08-20T12:01:00.000Z",
        token: "00000000-0000-4000-8000-000000000004",
      })}\n`,
    );

    await expect(recoverRunLocks(expected.runId, () => "alive", true)).rejects.toThrow(
      /still running.*no lock was removed/i,
    );
    await expect(readFile(lockPath, "utf8")).resolves.toContain(String(process.pid));
  });

  it("does not remove a verification lock replaced during the operation", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    await store(expected);
    let lockPath = "";

    await withVerificationLock(expected.runId, async (location) => {
      lockPath = join(location.directory, ".verify.lock");
      await rm(lockPath);
      await writeFile(lockPath, "replacement\n");
    });

    await expect(readFile(lockPath, "utf8")).resolves.toBe("replacement\n");
    await rm(lockPath);
  });

  it("allows only one concurrent verification record commit", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    await store(expected);

    await withVerificationLock(expected.runId, async (location, prepared, session) => {
      await writeEvidence(location, "install", "observed", session);
      const verified: RunRecord = {
        ...prepared,
        status: "verified",
        verification: {
          verifier: currentRunMetadata(),
          startedAt: "2026-08-20T12:01:00.000Z",
          completedAt: "2026-08-20T12:02:00.000Z",
          outcome: "inconclusive",
          results: [result("install", "passed", "ok", ["install"])],
          omittedChecks: [{ id: "build", reason: "No build command." }],
        },
      };

      const attempts = await Promise.allSettled([
        writeRunRecord(location, verified, session),
        writeRunRecord(location, verified, session),
      ]);
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    });
    await expect(readRunRecord(expected.runId)).resolves.toMatchObject({ status: "verified" });
  });
});
