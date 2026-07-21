import { z } from "zod";

export const resourceSchema = z.object({
  kind: z.enum(["website", "markdown", "mcp", "skill", "blueprint"]),
  locator: z.url(),
  revision: z.string().min(1).optional(),
  retrievedAt: z.iso.datetime(),
});

const starterSourceSchema = z.union([z.url(), z.string().regex(/^builtin:[a-z0-9][a-z0-9-]*$/)]);

export const trialSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  task: z.string().min(1),
  starterRepository: z.object({
    source: starterSourceSchema,
    revision: z.string().min(1),
  }),
  resources: z.array(resourceSchema).min(1),
  runtime: z.object({
    installCommand: z.string().min(1),
    buildCommand: z.string().min(1),
    startCommand: z.string().min(1),
  }),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

export const trialOutcomeSchema = z.enum(["passed", "failed", "inconclusive"]);

export const trialStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "inconclusive",
  "cancelled",
]);

export const trialEventSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime(),
  phase: z.enum(["prepare", "execute", "build", "preview", "verify", "report"]),
  type: z.enum(["started", "completed", "failed", "log"]),
  message: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).default([]),
});

export const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "input",
    "agent-trace",
    "command",
    "source",
    "preview",
    "browser",
    "grader",
    "report",
  ]),
  createdAt: z.iso.datetime(),
  mediaType: z.string().min(1),
  content: z.string(),
  redacted: z.boolean(),
});

export const graderResultSchema = z.object({
  criterion: z.string().min(1),
  outcome: trialOutcomeSchema,
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const trialRunSchema = z.object({
  id: z.string().min(1),
  specId: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  status: trialStatusSchema,
  events: z.array(trialEventSchema),
  evidence: z.array(evidenceSchema),
  graderResults: z.array(graderResultSchema),
});

export const axReportSchema = z.object({
  runId: z.string().min(1),
  outcome: trialOutcomeSchema,
  markdown: z.string().min(1),
});

export function deriveTrialOutcome(
  expectedCriteria: readonly string[],
  results: readonly GraderResult[],
): TrialOutcome {
  const expected = new Set(expectedCriteria);
  const relevantResults = results.filter((result) => expected.has(result.criterion));

  if (relevantResults.some((result) => result.outcome === "failed")) return "failed";

  const complete =
    expectedCriteria.length > 0 &&
    results.length === expectedCriteria.length &&
    expectedCriteria.every((criterion) => {
      const matches = results.filter((result) => result.criterion === criterion);
      return matches.length === 1 && matches[0]?.outcome === "passed";
    });

  return complete ? "passed" : "inconclusive";
}

export type TrialSpec = z.infer<typeof trialSpecSchema>;
export type TrialEvent = z.infer<typeof trialEventSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type GraderResult = z.infer<typeof graderResultSchema>;
export type TrialOutcome = z.infer<typeof trialOutcomeSchema>;
export type TrialRun = z.infer<typeof trialRunSchema>;
export type AXReport = z.infer<typeof axReportSchema>;
