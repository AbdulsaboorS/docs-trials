import { describe, expect, it } from "vitest";
import { realtimekitTrial } from "../src/fixture";
import { restoreSyntheticRealtimeKitRun, runLocalTrial } from "../src/local-runner";
import { parseResultForRun } from "../ui/result-schema";
import {
  resultMatchesRunPath,
  runIdFromPath,
  sampleSyntheticRunId,
  unsupportedCustomRunId,
} from "../ui/run-route";

describe("local run routes", () => {
  it("parses refreshed run and report URLs", () => {
    const runId = "realtimekit-video-room-v1-1784203200000";
    expect(runIdFromPath(`/runs/${runId}`)).toBe(runId);
    expect(runIdFromPath(`/reports/${runId}`)).toBe(runId);
    expect(resultMatchesRunPath(`/runs/${runId}`, runId)).toBe(true);
  });

  it("does not reuse stale results for unsupported or malformed routes", () => {
    expect(resultMatchesRunPath(`/runs/${unsupportedCustomRunId}`, "previous-run")).toBe(false);
    expect(runIdFromPath("/runs/")).toBeUndefined();
    expect(runIdFromPath("/runs/%E0%A4%A")).toBeUndefined();
  });

  it("keeps sample-report links bound to a restorable package", () => {
    expect(restoreSyntheticRealtimeKitRun(sampleSyntheticRunId)?.run.id).toBe(sampleSyntheticRunId);
  });

  it("rejects malformed and mismatched hydrated packages", () => {
    const result = runLocalTrial(realtimekitTrial, new Date("2026-07-16T12:00:00.000Z"));
    expect(parseResultForRun(result, result.run.id).run.id).toBe(result.run.id);
    expect(() => parseResultForRun({}, result.run.id)).toThrow();
    expect(() => parseResultForRun(result, "another-run")).toThrow("does not match");
    expect(() =>
      parseResultForRun(
        { ...result, report: { ...result.report, runId: "another-run" } },
        result.run.id,
      ),
    ).toThrow("does not match");
  });
});
