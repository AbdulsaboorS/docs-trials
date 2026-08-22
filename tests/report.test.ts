import { describe, expect, it } from "vitest";
import { manifestSchema } from "../src/core/manifest";
import { checkIds, result, type CheckResult } from "../src/core/outcome";
import { renderReport } from "../src/core/report";
import type { RunRecord } from "../src/core/run";
import { currentRunMetadata } from "../src/core/run";

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
    preparation: {
      ...currentRunMetadata(),
      cliVersion: "prepare-cli",
      runtime: {
        nodeVersion: "v22.1.0",
        platform: "darwin",
        release: "prepare-release",
        arch: "arm64",
      },
    },
    documentation: [
      {
        status: "frozen",
        sourceType: "url",
        label: "https://example.com/docs",
        sourceUrl: "https://example.com/docs",
        finalUrl: "https://example.com/reference",
        retrievedAt: "2026-08-04T12:00:00.000Z",
        httpStatus: 200,
        contentType: "text/html",
        sha256: "b".repeat(64),
        byteLength: 123,
        file: "documentation/001-https-example-com-docs.txt",
      },
    ],
    verification: {
      verifier: {
        ...currentRunMetadata(),
        cliVersion: "verify-cli",
        runtime: {
          nodeVersion: "v24.2.0",
          platform: "linux",
          release: "verify-release",
          arch: "x64",
        },
      },
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

  it("reports runtime and frozen documentation provenance", () => {
    const markdown = renderReport(record([result("install", "passed", "ok")], "inconclusive"));

    expect(markdown).toContain("Verifier: Docs Trials verify-cli (schema 1)");
    expect(markdown).toContain("v24.2.0 on linux verify-release (x64)");
    expect(markdown).toContain("Prepared with: Docs Trials prepare-cli (schema 1)");
    expect(markdown).toContain("v22.1.0 on darwin prepare-release (arm64)");
    expect(markdown).toContain("[frozen copy](documentation/001-https-example-com-docs.txt)");
    expect(markdown).toContain("source https://example.com/docs");
    expect(markdown).toContain(`SHA-256 \`${"b".repeat(64)}\``);
    expect(markdown).toContain("final URL https://example.com/reference");
  });

  it("reports incomplete snapshots as live documentation", () => {
    const base = record([result("install", "passed", "ok")], "inconclusive");
    const markdown = renderReport({
      ...base,
      documentation: [
        {
          status: "live",
          sourceType: "url",
          label: "Docs",
          sourceUrl: "https://example.com/docs",
          retrievedAt: "2026-08-04T12:00:00.000Z",
          error: "Documentation retrieval timed out.",
        },
      ],
    });

    expect(markdown).toContain("live source https://example.com/docs");
    expect(markdown).toContain("Snapshot incomplete: Documentation retrieval timed out.");
    expect(markdown).toContain("Attempted 2026-08-04T12:00:00.000Z.");
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
        ungradedObservations: [
          { detail: "404 http://127.0.0.1/optional", evidenceIds: ["browser"] },
        ],
      },
    };
    const markdown = renderReport(withUngraded);
    expect(markdown).toContain("## Ungraded observations");
    expect(markdown).toContain("404 http://127.0.0.1/optional");
    expect(markdown).toContain("[browser](evidence/browser.txt)");
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
      preparation: verified.preparation,
      documentation: verified.documentation,
    };
    expect(() => renderReport(unverified)).toThrow(/before verification/);
  });
});
