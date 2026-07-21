import { z } from "zod";

export const runLimitsSchema = z.object({
  maxAgentSteps: z.number().int().min(1).max(50),
  maxWorkflowSeconds: z.number().int().min(60).max(3_600),
  maxSandboxSeconds: z.number().int().min(30).max(1_800),
  maxBrowserSeconds: z.number().int().min(15).max(600),
  maxCommandOutputBytes: z.number().int().min(1_024).max(1_000_000),
  maxEvidenceBytes: z.number().int().min(1_024).max(50_000_000),
});

export const runIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid controlled run ID.");

export const retentionPolicySchema = z.object({
  days: z.number().int().min(1).max(30),
});

export const internalRunPolicySchema = z.object({
  limits: runLimitsSchema,
  retention: retentionPolicySchema,
});

export const internalRunPolicy = internalRunPolicySchema.parse({
  limits: {
    maxAgentSteps: 12,
    maxWorkflowSeconds: 900,
    maxSandboxSeconds: 600,
    maxBrowserSeconds: 120,
    maxCommandOutputBytes: 200_000,
    maxEvidenceBytes: 10_000_000,
  },
  retention: { days: 7 },
});

export function retentionExpiresAt(admittedAt: Date, retentionDays: number): string {
  return new Date(admittedAt.getTime() + retentionDays * 24 * 60 * 60 * 1_000).toISOString();
}

export type RunLimits = z.infer<typeof runLimitsSchema>;
export type InternalRunPolicy = z.infer<typeof internalRunPolicySchema>;
