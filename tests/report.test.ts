import { describe, expect, it } from "vitest";
import type { GraderResult, TrialRun } from "../src/domain";
import { deriveTrialOutcome } from "../src/domain";
import { updatesFilterSmokeTrial } from "../src/fixture";
import { runLocalTrial } from "../src/local-runner";
import { renderAXReport } from "../src/report";

const base = runLocalTrial(updatesFilterSmokeTrial, new Date("2026-07-20T12:00:00.000Z"));

function withResults(results: GraderResult[]): TrialRun {
  return {
    ...base.run,
    status: deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, results),
    graderResults: results,
  };
}

describe("trial outcome and report", () => {
  it("passes only when every expected criterion passed exactly once", () => {
    expect(
      deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, base.run.graderResults),
    ).toBe("passed");
    const incompleteResults = base.run.graderResults.slice(1);
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, incompleteResults)).toBe(
      "inconclusive",
    );
    const report = renderAXReport(updatesFilterSmokeTrial, withResults(incompleteResults));
    expect(report.markdown).toContain("No grader result was produced.");
    expect(report.markdown).toContain("Missing grader result for:");
  });

  it("gives a deterministic failure precedence over an inconclusive result", () => {
    const results = base.run.graderResults.map((result, index) => ({
      ...result,
      outcome:
        index === 0
          ? ("failed" as const)
          : index === 1
            ? ("inconclusive" as const)
            : result.outcome,
    }));
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, results)).toBe("failed");
    expect(renderAXReport(updatesFilterSmokeTrial, withResults(results)).outcome).toBe("failed");
  });

  it("permits only an explained operational downgrade", () => {
    const results = base.run.graderResults.map((result, index) => ({
      ...result,
      outcome: index === 0 ? ("failed" as const) : result.outcome,
    }));
    const run = { ...withResults(results), status: "inconclusive" as const };
    const report = renderAXReport(updatesFilterSmokeTrial, run, {
      operationalDowngrade: "Cleanup verification was unavailable.",
    });

    expect(report.outcome).toBe("inconclusive");
    expect(report.markdown).toContain("**INCONCLUSIVE**");
    expect(report.markdown).toContain("| FAILED |");
    expect(report.markdown).toContain("Cleanup verification was unavailable.");
    expect(() => renderAXReport(updatesFilterSmokeTrial, run)).toThrow("does not match");
  });

  it("reports an environment interruption as unresolved rather than a docs failure", () => {
    const results = base.run.graderResults.map((result, index) =>
      index === 2
        ? {
            ...result,
            outcome: "inconclusive" as const,
            detail: "The Browser Run environment stopped before this check completed.",
          }
        : result,
    );
    const report = renderAXReport(updatesFilterSmokeTrial, withResults(results));

    expect(report.outcome).toBe("inconclusive");
    expect(report.markdown).toContain("## Unresolved Verification");
    expect(report.markdown).toContain("Browser Run environment stopped");
    expect(report.markdown).toContain("It is not a documentation failure.");
    expect(report.markdown).toContain("No deterministic acceptance criterion failed.");
  });
});
