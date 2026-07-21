import {
  deriveTrialOutcome,
  trialRunSchema,
  type AXReport,
  type Evidence,
  type GraderResult,
  type TrialEvent,
  type TrialRun,
  type TrialSpec,
} from "./domain";
import { redact } from "./redact";
import { renderAXReport } from "./report";

export type LocalTrialPackage = {
  trial: TrialSpec;
  run: TrialRun;
  report: AXReport;
};

const phases = ["prepare", "execute", "build", "preview", "verify", "report"] as const;

export function runLocalTrial(spec: TrialSpec, at = new Date()): LocalTrialPackage {
  const timestamp = at.toISOString();
  const runId = `${spec.id}-${at.getTime()}`;
  const evidence = phases.map<Evidence>((phase, index) => ({
    id: `evidence-${index + 1}`,
    kind: phase === "verify" ? "browser" : phase === "report" ? "report" : "command",
    createdAt: timestamp,
    mediaType: "application/json",
    content: redact(
      JSON.stringify({
        phase,
        status: "completed",
        previewUrl: phase === "preview" ? "https://preview.docs-trials.invalid" : undefined,
        authorization: "Bearer test-token-must-not-persist",
      }),
    ),
    redacted: true,
  }));
  const events = phases.flatMap<TrialEvent>((phase, index) => [
    {
      id: `event-${index + 1}-started`,
      at: timestamp,
      phase,
      type: "started",
      message: `${phase} started`,
      evidenceIds: [],
    },
    {
      id: `event-${index + 1}-completed`,
      at: timestamp,
      phase,
      type: "completed",
      message: `${phase} completed`,
      evidenceIds: [`evidence-${index + 1}`],
    },
  ]);
  const graderResults = spec.acceptanceCriteria.map<GraderResult>((criterion) => ({
    criterion,
    outcome: "passed",
    detail: "Deterministic local test double completed this criterion.",
    evidenceIds: ["evidence-5"],
  }));
  const outcome = deriveTrialOutcome(spec.acceptanceCriteria, graderResults);
  const run = trialRunSchema.parse({
    id: runId,
    specId: spec.id,
    startedAt: timestamp,
    completedAt: timestamp,
    status: outcome,
    events,
    evidence,
    graderResults,
  });

  return {
    trial: spec,
    run,
    report: renderAXReport(spec, run, {
      evidenceMode:
        "Synthetic local test double for exercising the package and report shape. No coding agent, Sandbox, Browser Run session, or external integration was executed. This outcome is not a documentation finding.",
    }),
  };
}
