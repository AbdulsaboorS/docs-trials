import { runBaseline } from "../checks";
import { deriveOutcome } from "../core/outcome";
import { renderReport } from "../core/report";
import {
  readRunRecord,
  runDirectory,
  writeArtifact,
  writeEvidence,
  writeRunRecord,
} from "../core/run";
import { readDiff } from "../util/git";

export type VerifyOptions = { run: string; quiet: boolean };

export async function verify(options: VerifyOptions) {
  const record = await readRunRecord(options.run);
  const startedAt = new Date().toISOString();
  const report = options.quiet ? () => {} : (line: string) => process.stderr.write(`  ${line}\n`);

  const baseline = await runBaseline(record.manifest, record.workspace, report);

  for (const item of baseline.evidence) {
    await writeEvidence(record.runId, item.id, item.content);
  }
  if (record.baselineRevision) {
    await writeEvidence(
      record.runId,
      "source-diff",
      await readDiff(record.workspace, record.baselineRevision),
    );
  }

  const outcome = deriveOutcome(baseline.results);
  const verified = {
    ...record,
    status: "verified" as const,
    verification: {
      startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      results: baseline.results,
    },
  };

  await writeRunRecord(verified);
  const markdown = renderReport(verified);
  await writeArtifact(record.runId, "AX.md", markdown);
  await writeArtifact(
    record.runId,
    "results.json",
    `${JSON.stringify({ runId: record.runId, outcome, results: baseline.results }, null, 2)}\n`,
  );

  return {
    runId: record.runId,
    outcome,
    results: baseline.results,
    directory: runDirectory(record.runId),
    markdown,
  };
}
