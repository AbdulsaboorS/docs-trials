import { describe, expect, it } from "vitest";
import { evaluateUpdatesFilterObservations } from "../src/updates-filter-grader";

describe("updates-filter browser grader", () => {
  it("passes each visible behavior when all observations match", () => {
    const results = evaluateUpdatesFilterObservations({
      headingVisible: true,
      initialUpdateCount: 3,
      initialUpdateText: "Faster previews Clearer evidence Safer trial limits",
      platformUpdateCount: 1,
      platformUpdateText: "Faster previews Platform",
      emptyMessageVisible: true,
      consoleMessages: [],
      networkFailures: [],
      unexpectedExternalRequests: [],
    });

    expect(results).toHaveLength(5);
    expect(results.every((result) => result.outcome === "passed")).toBe(true);
  });

  it("fails only the browser behaviors contradicted by evidence", () => {
    const results = evaluateUpdatesFilterObservations({
      headingVisible: true,
      initialUpdateCount: 2,
      initialUpdateText: "Faster previews Clearer evidence",
      platformUpdateCount: 2,
      platformUpdateText: "Faster previews Clearer evidence",
      emptyMessageVisible: false,
      consoleMessages: ["Uncaught Error"],
      networkFailures: ["500 https://preview.invalid/api"],
      unexpectedExternalRequests: ["https://example.com/data.json"],
    });

    expect(results.map((result) => result.outcome)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
  });
});
