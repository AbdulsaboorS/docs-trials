import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaselineRun } from "../src/checks";
import { verify, type VerifyDependencies } from "../src/commands/verify";
import { digestManifest, manifestSchema } from "../src/core/manifest";
import { checkIds, result } from "../src/core/outcome";
import {
  readRunRecord,
  reserveRunDirectory,
  currentRunMetadata,
  writeArtifact,
  writeEvidence,
  writeRunRecord,
  type RunLocation,
} from "../src/core/run";

let home: string;
const runBaselineMock = vi.fn<VerifyDependencies["runBaseline"]>();
const readDiffMock = vi.fn<VerifyDependencies["readDiff"]>();
const verifierMetadata = {
  cliVersion: "verify-cli",
  schemaVersion: 1 as const,
  runtime: {
    nodeVersion: "v24.2.0",
    platform: "linux",
    release: "verify-release",
    arch: "x64",
  },
};
const dependencies: VerifyDependencies = {
  runBaseline: runBaselineMock,
  readDiff: readDiffMock,
  metadata: () => verifierMetadata,
  now: () => new Date(),
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "docs-trials-verify-"));
  vi.stubEnv("DOCS_TRIALS_HOME", home);
  runBaselineMock.mockReset();
  runBaselineMock.mockResolvedValue(cleanBaseline());
  readDiffMock.mockReset();
  readDiffMock.mockResolvedValue("No source change.");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

async function preparedRun(): Promise<RunLocation> {
  const preparedAt = new Date();
  const location = await reserveRunDirectory("sample", preparedAt);
  const manifest = manifestSchema.parse({
    version: 1,
    id: "sample",
    title: "Sample",
    task: "Build something.",
    docs: ["https://example.com/docs"],
    run: { install: "true", build: "true", start: "true" },
  });
  await writeRunRecord(location, {
    runId: location.runId,
    status: "prepared",
    manifest,
    manifestDigest: digestManifest(manifest),
    workspace: "/tmp/workspace",
    preparedAt: preparedAt.toISOString(),
    preparation: currentRunMetadata(),
    documentation: [
      {
        status: "live",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        retrievedAt: preparedAt.toISOString(),
        error: "Test fixture did not retrieve documentation.",
      },
    ],
  });
  return location;
}

function cleanBaseline(): BaselineRun {
  return {
    results: checkIds.map((id) => result(id, "passed", "observed", [evidenceForCheck(id)])),
    evidence: ["install", "build", "boot", "browser"].map((id) => ({
      id,
      content: `complete ${id} evidence\n`,
    })),
    ungradedObservations: [],
    omittedChecks: [],
  };
}

function evidenceForCheck(id: (typeof checkIds)[number]): string {
  if (id === "install" || id === "build" || id === "boot") return id;
  return "browser";
}

describe("verify", () => {
  it("records verifier metadata separately from preparation metadata", async () => {
    const location = await preparedRun();
    const prepared = await readRunRecord(location.runId);

    const result = await verify({ run: location.runId, quiet: true }, dependencies);
    const verified = await readRunRecord(location.runId);

    expect(verified).toMatchObject({
      preparation: prepared.preparation,
      verification: { verifier: verifierMetadata },
    });
    expect(result.markdown).toContain("Verifier: Docs Trials verify-cli (schema 1)");
    expect(result.markdown).toContain("Prepared with: Docs Trials 0.1.0 (schema 1)");
  });

  it("allows only one concurrent verifier to execute the baseline", async () => {
    const location = await preparedRun();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const didEnter = new Promise<void>((resolve) => {
      entered = resolve;
    });
    runBaselineMock.mockImplementationOnce(async () => {
      entered();
      await held;
      return cleanBaseline();
    });

    const first = verify({ run: location.runId, quiet: true }, dependencies);
    await didEnter;
    await expect(verify({ run: location.runId, quiet: true }, dependencies)).rejects.toThrow(
      /already being verified/i,
    );
    release();
    await expect(first).resolves.toMatchObject({ outcome: "passed" });
    expect(runBaselineMock).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an already verified attempt", async () => {
    const location = await preparedRun();
    await verify({ run: location.runId, quiet: true }, dependencies);
    const completed = await readRunRecord(location.runId);

    await expect(verify({ run: location.runId, quiet: true }, dependencies)).rejects.toThrow(
      /already verified/i,
    );
    await expect(readRunRecord(location.runId)).resolves.toEqual(completed);
    await expect(writeArtifact(location, "AX.md", "replacement")).rejects.toThrow(
      /cannot be overwritten/i,
    );
    await expect(writeEvidence(location, "install", "replacement")).rejects.toThrow(
      /cannot be overwritten/i,
    );
    expect(runBaselineMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the canonical record prepared when evidence writing fails", async () => {
    const location = await preparedRun();
    runBaselineMock.mockResolvedValueOnce({
      ...cleanBaseline(),
      evidence: [{ id: "../outside", content: "unsafe" }],
    });

    await expect(verify({ run: location.runId, quiet: true }, dependencies)).rejects.toThrow();
    await expect(readRunRecord(location.runId)).resolves.toMatchObject({ status: "prepared" });

    await expect(verify({ run: location.runId, quiet: true }, dependencies)).resolves.toMatchObject(
      {
        outcome: "passed",
      },
    );
  });

  it("commits run.json only after report and result artifacts succeed", async () => {
    const location = await preparedRun();
    await mkdir(join(location.directory, "AX.md"));

    await expect(verify({ run: location.runId, quiet: true }, dependencies)).rejects.toThrow();
    await expect(readRunRecord(location.runId)).resolves.toMatchObject({ status: "prepared" });

    await rm(join(location.directory, "AX.md"), { recursive: true });
    await expect(verify({ run: location.runId, quiet: true }, dependencies)).resolves.toMatchObject(
      {
        outcome: "passed",
      },
    );
    await expect(readRunRecord(location.runId)).resolves.toMatchObject({ status: "verified" });
  });
});
