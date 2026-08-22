import { z } from "zod";

/**
 * Every check is code that Docs Trials owns. A result can only exist for a
 * check identifier defined here.
 *
 * This is deliberate. An earlier design keyed results by the user's own
 * criterion text and assigned a shell command's exit code to whichever
 * criterion happened to be first. That let `echo hello` report a verified
 * payment flow. Results are now bound to the code that produced them, so a
 * criterion the runner never evaluated cannot receive an outcome.
 */
export const checkIds = [
  "install",
  "build",
  "boot",
  "page-load",
  "visible-content",
  "console-errors",
  "resource-loads",
  "server-errors",
  "client-secrets",
  "network-egress",
] as const;

export const checkIdSchema = z.enum(checkIds);
export type CheckId = z.infer<typeof checkIdSchema>;

/** What each check asserts. Fixed text. Never derived from user input. */
export const checkTitles = {
  install: "Dependencies install successfully.",
  build: "The project builds successfully.",
  boot: "The application starts and answers an HTTP request.",
  "page-load": "The entry page loads without an HTTP or navigation error.",
  "visible-content": "The page renders visible content.",
  "console-errors": "No uncaught or application console error occurs.",
  "resource-loads": "Same-origin browser assets load successfully.",
  "server-errors": "No request returns a 5xx response.",
  "client-secrets": "Captured same-origin browser content contains no detected secret.",
  "network-egress": "The page contacts no unexpected external origin.",
} satisfies Record<CheckId, string>;

export const outcomeSchema = z.enum(["passed", "failed", "inconclusive"]);
export type Outcome = z.infer<typeof outcomeSchema>;

export const ungradedObservationSchema = z
  .object({
    detail: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((observation, context) => {
    if (new Set(observation.evidenceIds).size !== observation.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Evidence references must be unique.",
      });
    }
  });
export type UngradedObservation = z.infer<typeof ungradedObservationSchema>;

export const checkResultSchema = z
  .object({
    id: checkIdSchema,
    title: z.string().min(1),
    outcome: outcomeSchema,
    detail: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.title !== checkTitles[entry.id]) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: `Expected the fixed title for ${entry.id}.`,
      });
    }
    if (new Set(entry.evidenceIds).size !== entry.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Evidence references must be unique.",
      });
    }
  });

export type CheckResult = z.infer<typeof checkResultSchema>;

export function result(
  id: CheckId,
  outcome: Outcome,
  detail: string,
  evidenceIds: string[] = [],
): CheckResult {
  return { id, title: checkTitles[id], outcome, detail, evidenceIds };
}

/**
 * A run passes only when every check ran and passed. One observed failure
 * fails the run. Missing or unavailable evidence makes it inconclusive.
 *
 * An inconclusive run is not a documentation finding. It means Docs Trials
 * could not observe enough to decide.
 */
export function deriveOutcome(
  results: readonly CheckResult[],
  applicableChecks: readonly CheckId[] = checkIds,
): Outcome {
  if (results.length === 0) return "inconclusive";
  if (results.some((entry) => entry.outcome === "failed")) return "failed";
  const seen = new Set(results.map((entry) => entry.id));
  const applicable = new Set(applicableChecks);
  const complete = applicableChecks.every((id) => seen.has(id));
  const containsOnlyApplicableChecks = results.every((entry) => applicable.has(entry.id));
  const allPassed = results.every((entry) => entry.outcome === "passed");
  return complete && containsOnlyApplicableChecks && allPassed && seen.size === results.length
    ? "passed"
    : "inconclusive";
}

export function countByOutcome(results: readonly CheckResult[]): Record<Outcome, number> {
  return results.reduce(
    (totals, entry) => ({ ...totals, [entry.outcome]: totals[entry.outcome] + 1 }),
    { passed: 0, failed: 0, inconclusive: 0 },
  );
}
