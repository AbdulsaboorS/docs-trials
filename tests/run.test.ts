import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { digestManifest, manifestSchema } from "../src/core/manifest";
import { latestRunId, readRunRecord, writeRunRecord, type RunRecord } from "../src/core/run";

let home: string;

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
  };
}

describe("run records", () => {
  it("reads a valid record by run id or directory", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const path = await writeRunRecord(expected);

    await expect(readRunRecord(expected.runId)).resolves.toEqual(expected);
    await expect(readRunRecord(dirname(path))).resolves.toEqual(expected);
  });

  it("rejects a manifest that does not match its stored digest", async () => {
    const expected = record("sample-20260820-120000", "sample", "2026-08-20T12:00:00.000Z");
    const path = await writeRunRecord(expected);
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw.replace("Build something.", "Build something else."));

    await expect(readRunRecord(expected.runId)).rejects.toThrow(/manifest digest does not match/i);
  });

  it("selects the newest preparation across different manifest ids", async () => {
    await writeRunRecord(record("zz-old-20260820-120000", "zz-old", "2026-08-20T12:00:00.000Z"));
    const newest = record("aa-new-20260820-120100", "aa-new", "2026-08-20T12:01:00.000Z");
    await writeRunRecord(newest);

    await expect(latestRunId()).resolves.toBe(newest.runId);
    await expect(readRunRecord("latest")).resolves.toEqual(newest);
  });

  it("uses the run id as a deterministic timestamp tie-break", async () => {
    const preparedAt = "2026-08-20T12:00:00.000Z";
    await writeRunRecord(record("aa-same-20260820-120000", "aa-same", preparedAt));
    await writeRunRecord(record("zz-same-20260820-120000", "zz-same", preparedAt));

    await expect(latestRunId()).resolves.toBe("zz-same-20260820-120000");
  });

  it("orders timestamps with different fractional precision chronologically", async () => {
    await writeRunRecord(record("whole-20260820-120000", "whole", "2026-08-20T12:00:00Z"));
    await writeRunRecord(
      record("fraction-20260820-120000", "fraction", "2026-08-20T12:00:00.100Z"),
    );

    await expect(latestRunId()).resolves.toBe("fraction-20260820-120000");
  });

  it("surfaces a corrupt candidate instead of selecting an older valid run", async () => {
    await writeRunRecord(record("valid-20260820-120000", "valid", "2026-08-20T12:00:00.000Z"));
    const corruptDirectory = join(home, "corrupt-20260820-120100");
    await mkdir(corruptDirectory);
    await writeFile(join(corruptDirectory, "run.json"), "{}\n");

    await expect(latestRunId()).rejects.toThrow(/invalid run record/i);
  });
});
