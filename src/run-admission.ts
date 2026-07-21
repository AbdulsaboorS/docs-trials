import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  activeAdmissionSchema,
  admissionRequestSchema,
  decideAdmission,
  type ActiveAdmission,
  type AdmissionDecision,
  type AdmissionRequest,
} from "./run-admission-contract";

export {
  activeAdmissionSchema,
  admissionKey,
  admissionRequestSchema,
  cancellationRequested,
  decideAdmission,
  type ActiveAdmission,
  type AdmissionDecision,
  type AdmissionRequest,
} from "./run-admission-contract";

const activeKey = "active-admission";

export class RunAdmission extends DurableObject {
  async admit(input: AdmissionRequest): Promise<AdmissionDecision> {
    const request = admissionRequestSchema.parse(input);
    const active = await this.readActive();
    const decision = decideAdmission(active, request);
    if (decision.accepted && !decision.idempotent) {
      await this.ctx.storage.put(activeKey, decision.admission);
    }
    return decision;
  }

  async getActive(): Promise<ActiveAdmission | null> {
    return this.readActive();
  }

  async requestCancellation(runId: string, at: string): Promise<ActiveAdmission | null> {
    const active = await this.readActive();
    if (!active || active.runId !== runId) return null;

    const cancelled = activeAdmissionSchema.parse({
      ...active,
      cancellationRequestedAt: z.iso.datetime().parse(at),
    });
    await this.ctx.storage.put(activeKey, cancelled);
    return cancelled;
  }

  async release(runId: string): Promise<boolean> {
    const active = await this.readActive();
    if (!active || active.runId !== runId) return false;
    await this.ctx.storage.delete(activeKey);
    return true;
  }

  private async readActive(): Promise<ActiveAdmission | null> {
    const value = await this.ctx.storage.get(activeKey);
    return value === undefined ? null : activeAdmissionSchema.parse(value);
  }
}
