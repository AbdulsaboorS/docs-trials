import { describe, expect, it } from "vitest";
import {
  checkIds,
  checkResultSchema,
  deriveOutcome,
  result,
  type CheckResult,
} from "../src/core/outcome";

const all = (outcome: "passed" | "failed" | "inconclusive"): CheckResult[] =>
  checkIds.map((id) => result(id, outcome, "detail"));

describe("deriveOutcome", () => {
  it("passes only when every check ran and passed", () => {
    expect(deriveOutcome(all("passed"))).toBe("passed");
  });

  it("fails when any check failed, even if the rest passed", () => {
    const results = all("passed");
    results[3] = result("page-load", "failed", "HTTP 500");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it("is inconclusive when a check is missing", () => {
    expect(deriveOutcome(all("passed").slice(1))).toBe("inconclusive");
  });

  it("is inconclusive when any check is inconclusive", () => {
    const results = all("passed");
    results[2] = result("boot", "inconclusive", "port busy");
    expect(deriveOutcome(results)).toBe("inconclusive");
  });

  it("is inconclusive for an empty result set", () => {
    expect(deriveOutcome([])).toBe("inconclusive");
  });

  it("is inconclusive when a check reports twice", () => {
    const results = [...all("passed"), result("boot", "passed", "again")];
    expect(deriveOutcome(results)).toBe("inconclusive");
  });

  it("cannot be told to pass a criterion the checks do not define", () => {
    // The old model keyed results by user text and let one command's exit code
    // stand in for any claim. Results are now keyed by check id, so an
    // arbitrary criterion has nowhere to attach.
    const invented = checkResultSchema.safeParse({
      id: "payment-works",
      title: "A customer can complete a payment.",
      outcome: "passed",
      detail: "Invented result.",
      evidenceIds: [],
    });
    expect(invented.success).toBe(false);
  });
});

describe("result", () => {
  it("always uses the fixed title for the check id", () => {
    expect(result("install", "passed", "x").title).toBe("Dependencies install successfully.");
  });
});
