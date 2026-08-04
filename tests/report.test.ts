import { describe, expect, it } from "vitest";
import { manifestSchema } from "../src/core/manifest";
import { checkIds, result, type CheckResult } from "../src/core/outcome";
import { renderReport } from "../src/core/report";
import type { RunRecord } from "../src/core/run";

const manifest = manifestSchema.parse({
  version: 1,
  id: "sample",
  title: "Sample trial",
  task: "Build a checkout page.",
  docs: ["https://example.com/docs"],
  goals: ["A customer can complete a payment."],
  run: { start: "node server.mjs" },
});

function record(results: CheckResult[], outcome: "passed" | "failed" | "inconclusive"): RunRecord {
  return {
    runId: "sample-20260804-120000",
    status: "verified",
    manifest,
    manifestDigest: "a".repeat(64),
    workspace: "/tmp/ws",
    preparedAt: "2026-08-04T12:00:00.000Z",
    verification: {
      startedAt: "2026-08-04T12:00:00.000Z",
      completedAt: "2026-08-04T12:01:30.000Z",
      outcome,
      results,
    },
  };
}

describe("renderReport", () => {
  it("labels author goals as not verified", () => {
    const markdown = renderReport(
      record(
        checkIds.map((id) => result(id, "passed", "ok")),
        "passed",
      ),
    );
    expect(markdown).toContain("Author goals — not verified");
    expect(markdown).toContain("A customer can complete a payment.");
    expect(markdown).toContain("did **not** check any of them");
  });

  it("never presents a goal as a passing check", () => {
    const markdown = renderReport(
      record(
        checkIds.map((id) => result(id, "passed", "ok")),
        "passed",
      ),
    );
    const table = markdown.slice(markdown.indexOf("| Result |"), markdown.indexOf("## Observed"));
    expect(table).not.toContain("A customer can complete a payment.");
  });

  it("lists checks that never ran as inconclusive", () => {
    const partial = [result("install", "passed", "ok")];
    const markdown = renderReport(record(partial, "inconclusive"));
    expect(markdown).toContain("This check did not run.");
    expect(markdown).toContain("**INCONCLUSIVE**");
  });

  it("separates observed failures from unresolved checks", () => {
    const results = [
      result("install", "passed", "ok"),
      result("build", "failed", "exit 1"),
      result("boot", "inconclusive", "skipped"),
    ];
    const markdown = renderReport(record(results, "failed"));
    const failures = markdown.slice(markdown.indexOf("## Observed failures"));
    expect(failures).toContain("exit 1");
    expect(markdown).toContain("## Unresolved checks");
    expect(markdown).toContain("does not mean the");
  });

  it("refuses to render before verification", () => {
    const unverified = { ...record([], "inconclusive"), verification: undefined };
    expect(() => renderReport(unverified)).toThrow(/before verification/);
  });
});
