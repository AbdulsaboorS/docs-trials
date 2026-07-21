import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { graderResultSchema, trialSpecSchema } from "../src/domain";
import { realtimekitTrial, updatesFilterSmokeTrial } from "../src/fixture";
import { runLocalTrial } from "../src/local-runner";
import { redact } from "../src/redact";

describe("trial domain", () => {
  it("accepts the frozen RealtimeKit fixture", () => {
    expect(trialSpecSchema.parse(realtimekitTrial)).toEqual(realtimekitTrial);
  });

  it("accepts the frozen updates-filter smoke fixture", () => {
    expect(trialSpecSchema.parse(updatesFilterSmokeTrial)).toEqual(updatesFilterSmokeTrial);
    expect(updatesFilterSmokeTrial.starterRepository.source).toBe(
      "builtin:updates-filter-starter-v1",
    );
    const files = [
      "README.md",
      "index.html",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/App.jsx",
      "src/main.jsx",
      "src/styles.css",
      "vite.config.js",
    ];
    const hash = createHash("sha256");
    for (const file of files) {
      hash
        .update(file)
        .update("\0")
        .update(
          readFileSync(new URL(`../fixtures/updates-filter-starter/${file}`, import.meta.url)),
        )
        .update("\0");
    }
    expect(updatesFilterSmokeTrial.starterRepository.revision).toBe(`sha256:${hash.digest("hex")}`);
  });

  it("rejects a resource without a retrieval timestamp", () => {
    const invalid = {
      ...realtimekitTrial,
      resources: realtimekitTrial.resources.map((resource) => ({
        kind: resource.kind,
        locator: resource.locator,
        ...(resource.revision ? { revision: resource.revision } : {}),
      })),
    };
    expect(() => trialSpecSchema.parse(invalid)).toThrow();
  });

  it("redacts credential-shaped text", () => {
    expect(redact("Authorization: Bearer private-token")).not.toContain("private-token");
    expect(redact("api_key=private-key password=hunter2 token=private-token")).toBe(
      "[REDACTED] [REDACTED] [REDACTED]",
    );
    expect(redact('{"token":"private-token","api_key":"private-key"}')).toBe(
      '{"token":"[REDACTED]","api_key":"[REDACTED]"}',
    );
    expect(redact("https://example.com/callback?token=private-token&state=safe")).toBe(
      "https://example.com/callback?token=[REDACTED]&state=safe",
    );
  });

  it("requires an explicit three-state grader outcome", () => {
    expect(
      graderResultSchema.parse({
        criterion: "The page opens.",
        outcome: "inconclusive",
        detail: "The browser environment was unavailable.",
        evidenceIds: ["browser-environment"],
      }).outcome,
    ).toBe("inconclusive");
    expect(() =>
      graderResultSchema.parse({
        criterion: "The page opens.",
        passed: false,
        detail: "Ambiguous old result.",
        evidenceIds: ["browser-environment"],
      }),
    ).toThrow();
  });

  it("emits a complete deterministic local package", () => {
    const result = runLocalTrial(realtimekitTrial, new Date("2026-07-16T12:00:00.000Z"));
    expect(result.run.status).toBe("passed");
    expect(result.report.outcome).toBe("passed");
    expect(result.run.graderResults).toHaveLength(realtimekitTrial.acceptanceCriteria.length);
    expect(result.run.graderResults.every((grader) => grader.outcome === "passed")).toBe(true);
    expect(result.report.markdown).toContain("# Agent Experience Report");
    expect(result.report.markdown).toContain("Synthetic local test double");
    expect(result.run.evidence.every((evidence) => !evidence.content.includes("test-token"))).toBe(
      true,
    );
  });
});
