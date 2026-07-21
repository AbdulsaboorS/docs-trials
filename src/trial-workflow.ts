import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { z } from "zod";
import { assembleTrialArtifactPackage } from "./artifacts";
import { gradeUpdatesFilterPage } from "./browser-grader";
import {
  createSmokeGraderResults,
  unavailableBrowserGrade,
  type BrowserGrade,
  type SmokeBuildResult,
  type SmokePreviewResult,
} from "./controlled-run-results";
import {
  deriveTrialOutcome,
  trialRunSchema,
  type Evidence,
  type GraderResult,
  type TrialEvent,
} from "./domain";
import { updatesFilterSmokeTrial } from "./fixture";
import type { PlatformEnv } from "./platform-env";
import { redact, redactValue } from "./redact";
import { admissionKey, cancellationRequested } from "./run-admission";
import { runIdSchema, runLimitsSchema } from "./run-policy";
import {
  collectGeneratedSource,
  destroyTrialSandbox,
  executeSandboxLifecycleCommand,
  prepareSandboxWorkspace,
  PreviewApplicationError,
  startSandboxPreview,
} from "./sandbox-executor";
import { loadBuiltInStarter } from "./starter-assets";
import {
  cancelControlledTask,
  collectControlledTaskTrace,
  inspectControlledTask,
  purgeControlledTaskState,
  submitControlledTask,
} from "./trial-agent-client";
import { renderAXReport } from "./report";

export const trialWorkflowInputSchema = z.object({
  runId: runIdSchema,
  specId: z.literal("updates-filter-smoke-v1"),
  identityId: z.string().min(1).max(256),
  admittedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  retentionExpiresAt: z.iso.datetime(),
  limits: runLimitsSchema,
});

export type TrialWorkflowInput = z.infer<typeof trialWorkflowInputSchema>;

type AgentExecutionResult = {
  submissionId: string;
  status: "completed" | "aborted" | "skipped" | "error";
  error?: string;
};

export class TrialWorkflow extends WorkflowEntrypoint<PlatformEnv, TrialWorkflowInput> {
  override async run(event: Readonly<WorkflowEvent<TrialWorkflowInput>>, step: WorkflowStep) {
    const input = trialWorkflowInputSchema.parse(event.payload);
    const spec = updatesFilterSmokeTrial;
    let output: unknown;
    let submissionId: string | undefined;

    try {
      await step.do("prepare", { timeout: "2 minutes" }, async () => {
        await this.assertNotCancelled(input);
        const files = await loadBuiltInStarter(this.env.ASSETS, spec);
        return prepareSandboxWorkspace(this.env, input.runId, files, input.limits);
      });

      const submitted = await step.do(
        "execute-submit",
        { retries: { limit: 1, delay: "10 seconds" }, timeout: "1 minute" },
        async () => {
          await this.assertNotCancelled(input);
          return submitControlledTask(this.env, input.runId, spec);
        },
      );
      submissionId = submitted.submissionId;
      const agent = await this.waitForAgent(step, input, submitted.submissionId);
      const agentTranscript = await step.do("collect-agent-trace", { timeout: "1 minute" }, () =>
        collectControlledTaskTrace(this.env, input.runId),
      );
      const agentTrace = { submission: agent, messages: JSON.parse(agentTranscript) as unknown };

      const build = await step.do(
        "build",
        { retries: { limit: 1, delay: "10 seconds" }, timeout: "10 minutes" },
        async (): Promise<SmokeBuildResult> => {
          await this.assertNotCancelled(input);
          const installLimits = {
            ...input.limits,
            maxSandboxSeconds: this.remainingSandboxSeconds(input),
          };
          const install = await executeSandboxLifecycleCommand(
            this.env,
            input.runId,
            "install",
            spec.runtime.installCommand,
            installLimits,
          );
          await this.assertNotCancelled(input);
          const built = install.success
            ? await executeSandboxLifecycleCommand(
                this.env,
                input.runId,
                "build",
                spec.runtime.buildCommand,
                {
                  ...input.limits,
                  maxSandboxSeconds: this.remainingSandboxSeconds(input),
                },
              )
            : {
                phase: "build" as const,
                success: false,
                stdout: "",
                stderr: "Build skipped because dependency installation failed.",
                exitCode: 1,
              };
          return { install, build: built };
        },
      );

      const preview = await step.do(
        "preview",
        { timeout: "2 minutes" },
        async (): Promise<SmokePreviewResult> => {
          await this.assertNotCancelled(input);
          if (!build.install.success || !build.build.success) {
            return {
              available: false,
              detail: "Preview skipped because the build failed.",
              failureKind: "application",
            };
          }
          try {
            const handle = await startSandboxPreview(this.env, input.runId, spec, {
              ...input.limits,
              maxBrowserSeconds: Math.min(
                input.limits.maxBrowserSeconds,
                this.remainingSandboxSeconds(input, 10),
                this.remainingWorkflowSeconds(input, 10),
              ),
            });
            return { available: true, ...handle };
          } catch (error) {
            return {
              available: false,
              detail: safeError(error),
              failureKind:
                error instanceof PreviewApplicationError ? "application" : "infrastructure",
            };
          }
        },
      );

      const browser = await step.do(
        "verify",
        { timeout: "3 minutes" },
        async (): Promise<BrowserGrade> => {
          await this.assertNotCancelled(input);
          if (!preview.available) return unavailableBrowserGrade(preview.detail);
          try {
            return await gradeUpdatesFilterPage(
              this.env.BROWSER,
              preview.url,
              Math.min(
                input.limits.maxBrowserSeconds,
                this.remainingSandboxSeconds(input, 10),
                this.remainingWorkflowSeconds(input, 10),
              ),
            );
          } catch (error) {
            return unavailableBrowserGrade(safeError(error));
          }
        },
      );

      output = await step.do("report", { timeout: "2 minutes" }, async () => {
        await this.assertNotCancelled(input);
        const now = new Date().toISOString();
        const graderResults = createSmokeGraderResults(build, preview, browser);
        const events = createEvents(input.admittedAt, now, agent, build, preview);
        const evidence = createEvidence(
          input,
          now,
          agentTrace,
          build,
          preview,
          browser,
          graderResults,
        );
        const outcome = deriveTrialOutcome(spec.acceptanceCriteria, graderResults);
        const run = trialRunSchema.parse({
          id: input.runId,
          specId: spec.id,
          startedAt: input.admittedAt,
          completedAt: now,
          status: outcome,
          events,
          evidence,
          graderResults,
        });
        const report = renderAXReport(spec, run, {
          evidenceMode:
            "Prepared controlled-cloud run. Artifact contents were assembled but not persisted because Artifacts access is disabled.",
        });
        const generatedSource = await collectGeneratedSource(this.env, input.runId, input.limits);
        const artifactPackage = assembleTrialArtifactPackage({
          spec,
          run,
          report,
          generatedSource,
          agentTrace,
          commands: build,
          browserSummary: {
            sessionId: browser.sessionId,
            consoleMessages: browser.consoleMessages,
            networkFailures: browser.networkFailures,
            unexpectedExternalRequests: browser.unexpectedExternalRequests ?? [],
            screenshotCaptured: browser.screenshotCaptured,
          },
          ...(browser.screenshot ? { screenshot: browser.screenshot } : {}),
          maxBytes: input.limits.maxEvidenceBytes,
        });
        return {
          run,
          report,
          persistence: "blocked" as const,
          retentionExpiresAt: input.retentionExpiresAt,
          artifactManifest: artifactPackage.files.map((file) => ({
            path: file.path,
            mediaType: file.mediaType,
            bytes:
              typeof file.content === "string"
                ? new TextEncoder().encode(file.content).byteLength
                : file.content.byteLength,
          })),
        };
      });
    } finally {
      await step.do(
        "cleanup-resources",
        { retries: { limit: 3, delay: "10 seconds" }, timeout: "2 minutes" },
        async () => {
          const errors: string[] = [];
          try {
            await purgeControlledTaskState(this.env, input.runId, submissionId);
          } catch (error) {
            errors.push(safeError(error));
          }
          try {
            await destroyTrialSandbox(this.env, input.runId);
          } catch (error) {
            errors.push(safeError(error));
          }
          if (errors.length > 0) throw new Error(`Run cleanup failed: ${errors.join("; ")}`);
        },
      );
      await step.do("release-admission", { timeout: "30 seconds" }, () =>
        this.releaseAdmission(input),
      );
    }

    return output;
  }

  private async waitForAgent(
    step: WorkflowStep,
    input: TrialWorkflowInput,
    submissionId: string,
  ): Promise<AgentExecutionResult> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await this.assertNotCancelled(input);
      const submission = await step.do(
        `execute-status-${attempt + 1}`,
        { timeout: "30 seconds" },
        () => inspectControlledTask(this.env, input.runId, submissionId),
      );
      if (submission && ["completed", "aborted", "skipped", "error"].includes(submission.status)) {
        return {
          submissionId,
          status: submission.status as AgentExecutionResult["status"],
          ...(submission.error ? { error: redact(submission.error) } : {}),
        };
      }
      await step.sleep(`execute-wait-${attempt + 1}`, "5 seconds");
    }
    await cancelControlledTask(this.env, input.runId, submissionId);
    return { submissionId, status: "error", error: "Controlled agent exceeded its time limit." };
  }

  private async assertNotCancelled(input: TrialWorkflowInput): Promise<void> {
    const admission = this.env.RunAdmission.getByName(await admissionKey(input.identityId));
    const active = await admission.getActive();
    if (cancellationRequested(active, input.runId)) {
      throw new NonRetryableError("Trial run was cancelled or its admission expired.");
    }
  }

  private async releaseAdmission(input: TrialWorkflowInput): Promise<void> {
    const admission = this.env.RunAdmission.getByName(await admissionKey(input.identityId));
    await admission.release(input.runId);
  }

  private remainingSandboxSeconds(input: TrialWorkflowInput, minimum = 1): number {
    const deadline = Date.parse(input.admittedAt) + input.limits.maxSandboxSeconds * 1_000;
    return remainingSeconds(deadline, input.limits.maxSandboxSeconds, minimum);
  }

  private remainingWorkflowSeconds(input: TrialWorkflowInput, minimum = 1): number {
    return remainingSeconds(Date.parse(input.expiresAt), input.limits.maxWorkflowSeconds, minimum);
  }
}

function createEvents(
  startedAt: string,
  completedAt: string,
  agent: AgentExecutionResult,
  build: SmokeBuildResult,
  preview: SmokePreviewResult,
): TrialEvent[] {
  const phaseState = [
    ["prepare", true, "Frozen manifest and Sandbox workspace prepared.", "input"],
    [
      "execute",
      agent.status === "completed",
      `Controlled agent ended with ${agent.status}.`,
      "agent-trace",
    ],
    [
      "build",
      build.install.success && build.build.success,
      "Sandbox install and build completed.",
      "command-build",
    ],
    [
      "preview",
      preview.available,
      preview.available ? "Preview became reachable." : preview.detail,
      "preview",
    ],
    ["verify", true, "Deterministic Browser Run checks completed.", "browser-session"],
    ["report", true, "Redacted evidence package and AX.md assembled.", "grader-results"],
  ] as const;
  return phaseState.flatMap(([phase, succeeded, message, evidenceId], index) => [
    {
      id: `event-${index + 1}-started`,
      at: startedAt,
      phase,
      type: "started" as const,
      message: `${phase} started`,
      evidenceIds: [],
    },
    {
      id: `event-${index + 1}-${succeeded ? "completed" : "failed"}`,
      at: completedAt,
      phase,
      type: succeeded ? ("completed" as const) : ("failed" as const),
      message,
      evidenceIds: [evidenceId],
    },
  ]);
}

function createEvidence(
  input: TrialWorkflowInput,
  at: string,
  agentTrace: unknown,
  build: SmokeBuildResult,
  preview: SmokePreviewResult,
  browser: BrowserGrade,
  graderResults: GraderResult[],
): Evidence[] {
  return [
    evidence("input", "input", at, input),
    evidence("agent-trace", "agent-trace", at, agentTrace),
    evidence("command-build", "command", at, build),
    evidence("preview", "preview", at, preview),
    evidence("browser-session", "browser", at, {
      sessionId: browser.sessionId,
      consoleMessages: browser.consoleMessages,
      networkFailures: browser.networkFailures,
      unexpectedExternalRequests: browser.unexpectedExternalRequests ?? [],
      screenshotCaptured: browser.screenshotCaptured,
    }),
    evidence("grader-results", "grader", at, graderResults),
  ];
}

function evidence(id: string, kind: Evidence["kind"], at: string, value: unknown): Evidence {
  return {
    id,
    kind,
    createdAt: at,
    mediaType: "application/json",
    content: redact(JSON.stringify(redactValue(value))),
    redacted: true,
  };
}

function safeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function remainingSeconds(deadline: number, ceiling: number, minimum: number): number {
  const remaining = Math.floor((deadline - Date.now()) / 1_000);
  if (remaining < minimum) throw new NonRetryableError("Trial run exceeded its time limit.");
  return Math.min(ceiling, remaining);
}
