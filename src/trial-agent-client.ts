import { getAgentByName } from "agents";
import type { TrialSpec } from "./domain";
import type { PlatformEnv } from "./platform-env";

export type AgentSubmissionSnapshot = {
  submissionId: string;
  status: "pending" | "running" | "completed" | "aborted" | "skipped" | "error";
  error?: string;
};

export async function submitControlledTask(
  env: PlatformEnv,
  runId: string,
  spec: TrialSpec,
): Promise<AgentSubmissionSnapshot> {
  const agent = await getAgentByName(env.TrialCodingAgent, runId);
  const message = {
    id: `${runId}-task`,
    role: "user" as const,
    parts: [
      {
        type: "text" as const,
        text: [
          `Frozen task: ${spec.task}`,
          "Approved documentation:",
          ...spec.resources.map((resource) => `- ${resource.locator}`),
          "Inspect the starter workspace, implement only this task, and stop when the source is ready for an independent build.",
        ].join("\n"),
      },
    ],
  };
  const submission = await agent.submitMessages([message], {
    submissionId: `${runId}-submission`,
    idempotencyKey: `${runId}:execute:v1`,
    metadata: { runId, specId: spec.id },
  });
  return snapshot(submission);
}

export async function inspectControlledTask(
  env: PlatformEnv,
  runId: string,
  submissionId: string,
): Promise<AgentSubmissionSnapshot | null> {
  const agent = await getAgentByName(env.TrialCodingAgent, runId);
  const submission = await agent.inspectSubmission(submissionId);
  return submission ? snapshot(submission) : null;
}

export async function cancelControlledTask(
  env: PlatformEnv,
  runId: string,
  submissionId: string,
): Promise<void> {
  const agent = await getAgentByName(env.TrialCodingAgent, runId);
  await agent.cancelSubmission(submissionId, "Docs Trials run cancelled.");
}

export async function collectControlledTaskTrace(env: PlatformEnv, runId: string): Promise<string> {
  const agent = await getAgentByName(env.TrialCodingAgent, runId);
  return JSON.stringify(await agent.getMessages());
}

export async function purgeControlledTaskState(
  env: PlatformEnv,
  runId: string,
  submissionId?: string,
): Promise<void> {
  const agent = await getAgentByName(env.TrialCodingAgent, runId);
  if (submissionId) {
    let current = await inspectControlledTask(env, runId, submissionId);
    if (current && ["pending", "running"].includes(current.status)) {
      await agent.cancelSubmission(submissionId, "Docs Trials run cleanup.");
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      current = await inspectControlledTask(env, runId, submissionId);
      if (!current || !["pending", "running"].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (current && ["pending", "running"].includes(current.status)) {
      throw new Error("Controlled agent remained active after cancellation.");
    }
    await agent.deleteSubmission(submissionId);
  }
  await agent.deleteSubmissions({ status: ["completed", "error", "aborted", "skipped"] });
  await agent.clearMessages();
}

function snapshot(value: AgentSubmissionSnapshot): AgentSubmissionSnapshot {
  return {
    submissionId: value.submissionId,
    status: value.status,
    ...(value.error ? { error: value.error } : {}),
  };
}
