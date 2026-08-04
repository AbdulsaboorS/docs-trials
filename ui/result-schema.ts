import { z } from "zod";

const outcomeSchema = z.enum(["passed", "failed", "inconclusive"]);

export const resultSchema = z.object({
  report: z.object({
    runId: z.string().min(1),
    outcome: outcomeSchema,
    markdown: z.string(),
  }),
  run: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "running", "passed", "failed", "inconclusive", "cancelled"]),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    events: z.array(
      z.object({
        id: z.string().min(1),
        at: z.iso.datetime(),
        phase: z.enum(["prepare", "execute", "build", "preview", "verify", "report"]),
        type: z.enum(["started", "completed", "failed", "log"]),
        message: z.string(),
        evidenceIds: z.array(z.string()),
      }),
    ),
    graderResults: z.array(
      z.object({
        criterion: z.string().min(1),
        outcome: outcomeSchema,
      }),
    ),
  }),
});

export type Result = z.infer<typeof resultSchema>;

export function parseResultForRun(input: unknown, expectedRunId?: string): Result {
  const result = resultSchema.parse(input);
  if (
    result.run.id !== result.report.runId ||
    (expectedRunId !== undefined && result.run.id !== expectedRunId)
  ) {
    throw new Error("Synthetic run response does not match the requested run ID.");
  }
  return result;
}
