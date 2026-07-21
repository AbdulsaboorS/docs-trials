import type { AuthenticatedIdentity } from "./access-auth";
import {
  artifactRepositoryForEnv,
  destroyArtifactPersistenceSandbox,
  redactArtifactError,
} from "./artifacts";
import type { PlatformEnv } from "./platform-env";
import { admissionKey, type AdmissionDecision } from "./run-admission";
import { internalRunPolicy, retentionExpiresAt } from "./run-policy";
import { destroyTrialSandbox } from "./sandbox-executor";
import { purgeControlledTaskState } from "./trial-agent-client";
import { trialWorkflowInputSchema, type TrialWorkflowInput } from "./trial-workflow";

export async function createWorkflowAdmission(
  env: PlatformEnv,
  identity: AuthenticatedIdentity,
  runId: string,
  specId: string,
  at = new Date(),
): Promise<{ decision: AdmissionDecision; input: TrialWorkflowInput }> {
  const admittedAt = at.toISOString();
  const input = trialWorkflowInputSchema.parse({
    runId,
    specId,
    identityId: identity.id,
    admittedAt,
    expiresAt: new Date(
      at.getTime() + internalRunPolicy.limits.maxWorkflowSeconds * 1_000,
    ).toISOString(),
    retentionExpiresAt: retentionExpiresAt(at, internalRunPolicy.retention.days),
    limits: internalRunPolicy.limits,
  });
  const admission = env.RunAdmission.getByName(await admissionKey(identity.id));
  return { decision: await admission.admit(input), input };
}

export async function cancelCloudRun(
  env: PlatformEnv,
  identity: AuthenticatedIdentity,
  runId: string,
  at = new Date(),
): Promise<{ cancelled: boolean; cleanupErrors: string[] }> {
  const admission = env.RunAdmission.getByName(await admissionKey(identity.id));
  const active = await admission.requestCancellation(runId, at.toISOString());
  if (!active) return { cancelled: false, cleanupErrors: [] };

  const cleanupErrors: string[] = [];
  try {
    await terminateActiveWorkflow(env, runId);
  } catch (error) {
    cleanupErrors.push(redactArtifactError(error));
  }
  try {
    await purgeControlledTaskState(env, runId, `${runId}-submission`);
  } catch (error) {
    cleanupErrors.push(redactArtifactError(error));
  }
  try {
    await destroyTrialSandbox(env, runId);
  } catch (error) {
    cleanupErrors.push(redactArtifactError(error));
  }
  try {
    await destroyArtifactPersistenceSandbox(env, runId);
  } catch (error) {
    cleanupErrors.push(redactArtifactError(error));
  }
  try {
    await artifactRepositoryForEnv(env).delete(runId);
  } catch (error) {
    cleanupErrors.push(redactArtifactError(error));
  }
  if (cleanupErrors.length === 0) await admission.release(runId);
  return {
    cancelled: true,
    cleanupErrors,
  };
}

async function terminateActiveWorkflow(env: PlatformEnv, runId: string): Promise<void> {
  const instance = await env.TRIAL_WORKFLOW.get(runId);
  const status = await instance.status();
  if (["errored", "terminated", "complete"].includes(status.status)) return;
  try {
    await instance.terminate({ rollback: true });
  } catch (error) {
    const after = await instance.status();
    if (!["errored", "terminated", "complete"].includes(after.status)) throw error;
  }
}
