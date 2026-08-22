import { runBaseline } from "../checks";
import { checkIds, deriveOutcome } from "../core/outcome";
import { renderReport } from "../core/report";
import { redact } from "../core/redact";
import {
  currentRunMetadata,
  withVerificationLock,
  runRecordSchema,
  writeArtifact,
  writeEvidence,
  writeRunRecord,
  type ExecutionMetadata,
} from "../core/run";
import { readDiff } from "../util/git";

export type VerifyOptions = { run: string; quiet: boolean };
export type VerifyDependencies = {
  runBaseline: typeof runBaseline;
  readDiff: typeof readDiff;
  metadata: () => ExecutionMetadata;
  now: () => Date;
};

const defaultDependencies: VerifyDependencies = {
  runBaseline,
  readDiff,
  metadata: currentRunMetadata,
  now: () => new Date(),
};

export async function verify(
  options: VerifyOptions,
  dependencies: VerifyDependencies = defaultDependencies,
) {
  return withVerificationLock(options.run, async (location, record, session) => {
    const startedAt = dependencies.now().toISOString();
    const report = options.quiet ? () => {} : (line: string) => process.stderr.write(`  ${line}\n`);

    const baseline = await dependencies.runBaseline(record.manifest, record.workspace, report);

    const evidenceIds = baseline.evidence.map((item) => item.id);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new Error("Baseline produced duplicate evidence identifiers.");
    }
    const emittedEvidence = new Set(evidenceIds);
    if (record.baselineRevision && emittedEvidence.has("source-diff")) {
      throw new Error("Baseline evidence identifier source-diff is reserved by verification.");
    }
    for (const check of baseline.results) {
      for (const evidenceId of check.evidenceIds) {
        if (!emittedEvidence.has(evidenceId)) {
          throw new Error(
            `Check ${check.id} references evidence ${evidenceId} that this verification did not emit.`,
          );
        }
      }
    }
    for (const observation of baseline.ungradedObservations) {
      for (const evidenceId of observation.evidenceIds) {
        if (!emittedEvidence.has(evidenceId)) {
          throw new Error(
            `Ungraded observation references evidence ${evidenceId} that this verification did not emit.`,
          );
        }
      }
    }
    for (const item of baseline.evidence) {
      await writeEvidence(location, item.id, item.content, session);
    }
    const ungradedObservations = baseline.ungradedObservations.map((observation) => ({
      ...observation,
      detail: redact(observation.detail),
    }));
    if (record.baselineRevision) {
      const sourceDiff = await dependencies.readDiff(record.workspace, record.baselineRevision);
      await writeEvidence(location, "source-diff", sourceDiff.content, session);
      ungradedObservations.push({
        detail: redact(
          sourceDiff.complete
            ? "Source changes against the prepared baseline were recorded."
            : `Source changes against the prepared baseline were recorded incompletely: ${sourceDiff.detail}`,
        ),
        evidenceIds: ["source-diff"],
      });
    }

    const omittedIds = new Set(baseline.omittedChecks.map((entry) => entry.id));
    const applicableChecks = checkIds.filter((id) => !omittedIds.has(id));
    const outcome = deriveOutcome(baseline.results, applicableChecks);
    const verifiedRecord = runRecordSchema.parse({
      ...record,
      status: "verified" as const,
      verification: {
        verifier: dependencies.metadata(),
        startedAt,
        completedAt: dependencies.now().toISOString(),
        outcome,
        results: baseline.results,
        omittedChecks: baseline.omittedChecks,
        ungradedObservations,
      },
    });
    if (verifiedRecord.status !== "verified") {
      throw new Error("Verification did not produce a verified run record.");
    }
    const verified = verifiedRecord;

    const markdown = renderReport(verified);
    await writeArtifact(location, "AX.md", markdown, session);
    await writeArtifact(
      location,
      "results.json",
      `${JSON.stringify(
        {
          runId: verified.runId,
          outcome: verified.verification.outcome,
          results: verified.verification.results,
          omittedChecks: verified.verification.omittedChecks,
          ungradedObservations: verified.verification.ungradedObservations,
        },
        null,
        2,
      )}\n`,
      session,
    );
    await writeRunRecord(location, verified, session);

    return {
      runId: record.runId,
      outcome,
      results: baseline.results,
      directory: location.directory,
      markdown,
    };
  });
}
