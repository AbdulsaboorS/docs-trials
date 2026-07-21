import { z } from "zod";
import { runIdSchema, runLimitsSchema } from "./run-policy";

export const admissionRequestSchema = z.object({
  runId: runIdSchema,
  identityId: z.string().min(1).max(256),
  admittedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  retentionExpiresAt: z.iso.datetime(),
  limits: runLimitsSchema,
});

export const activeAdmissionSchema = admissionRequestSchema.extend({
  cancellationRequestedAt: z.iso.datetime().optional(),
});

export type AdmissionRequest = z.infer<typeof admissionRequestSchema>;
export type ActiveAdmission = z.infer<typeof activeAdmissionSchema>;

export type AdmissionDecision =
  | { accepted: true; admission: ActiveAdmission; idempotent: boolean }
  | { accepted: false; reason: "active-run-exists"; activeRunId: string };

export function decideAdmission(
  active: ActiveAdmission | null,
  input: AdmissionRequest,
): AdmissionDecision {
  const request = admissionRequestSchema.parse(input);
  if (active) {
    if (active.runId === request.runId && active.identityId === request.identityId) {
      return { accepted: true, admission: active, idempotent: true };
    }
    return { accepted: false, reason: "active-run-exists", activeRunId: active.runId };
  }
  return {
    accepted: true,
    admission: activeAdmissionSchema.parse(request),
    idempotent: false,
  };
}

export function cancellationRequested(
  active: ActiveAdmission | null,
  runId: string,
  at = new Date(),
): boolean {
  return (
    !active ||
    active.runId !== runId ||
    Boolean(active.cancellationRequestedAt) ||
    Date.parse(active.expiresAt) <= at.getTime()
  );
}

export async function admissionKey(identityId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identityId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
