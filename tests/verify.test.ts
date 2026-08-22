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
  writeArtifact,
  writeEvidence,
  writeRunRecord,
  type RunLocation,
} from "../src/core/run";

let home: string;
const runBaselineMock = vi.fn<VerifyDependencies["runBaseline"]>();
const readDiffMock = vi.fn<VerifyDependencies["readDiff"]>();
const dependencies: VerifyDependencies = { runBaseline: runBaselineMock, readDiff: readDiffMock };

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
