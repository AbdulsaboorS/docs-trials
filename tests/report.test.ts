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

function record(
  results: CheckResult[],
  outcome: "passed" | "failed" | "inconclusive",
): Extract<RunRecord, { status: "verified" }> {
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
      omittedChecks: [],
    },
  };
}

describe("renderReport", () => {
  it.each(["passed", "failed", "inconclusive"] as const)(
    "opens a %s report with the baseline outcome and task limitation",
    (outcome) => {
      const markdown = renderReport(record([result("install", outcome, "observed")], outcome));
      const limitation = "**Task fulfillment was not verified.**";

      expect(markdown.split("\n").slice(0, 5)).toEqual([
        "# Agent Experience Report",
        "",
        `**BASELINE ${outcome.toUpperCase()}**`,
        "",
        limitation,
      ]);
      expect(markdown.indexOf(limitation)).toBeLessThan(markdown.indexOf("- Trial:"));
      expect(markdown.indexOf(limitation)).toBeLessThan(markdown.indexOf("## Task"));
    },
  );

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
    expect(markdown).toContain("**BASELINE INCONCLUSIVE**");
  });

  it("links every recorded evidence reference", () => {
    const markdown = renderReport(
      record([result("install", "passed", "ok", ["install"])], "inconclusive"),
    );
    expect(markdown).toContain("[install](evidence/install.txt)");
  });

  it("lists lifecycle checks that were omitted without assigning an outcome", () => {
    const base = record([result("install", "passed", "ok", ["install"])], "inconclusive");
    const markdown = renderReport({
      ...base,
      verification: {
        ...base.verification,
        omittedChecks: [{ id: "build", reason: "No build command was declared." }],
      },
    });
    expect(markdown).toContain("## Omitted checks");
    expect(markdown).toContain("No build command was declared.");
    expect(markdown).not.toContain("The project builds successfully. | This check did not run.");
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

  it("lists observations that did not affect a check outcome", () => {
    const base = record([result("install", "passed", "ok")], "inconclusive");
    if (!base.verification) throw new Error("Expected a verified test record.");
    const withUngraded = {
      ...base,
      verification: {
        ...base.verification,
        ungradedObservations: ["404 http://127.0.0.1/optional"],
      },
    };
    const markdown = renderReport(withUngraded);
    expect(markdown).toContain("## Ungraded observations");
    expect(markdown).toContain("404 http://127.0.0.1/optional");
    expect(markdown).toContain("did not change a baseline check result");
  });

  it("refuses to render before verification", () => {
    const verified = record([], "inconclusive");
    const unverified: RunRecord = {
      runId: verified.runId,
      status: "prepared",
      manifest: verified.manifest,
      manifestDigest: verified.manifestDigest,
      workspace: verified.workspace,
      preparedAt: verified.preparedAt,
    };
    expect(() => renderReport(unverified)).toThrow(/before verification/);
  });
});
