import { deriveTrialOutcome, type AXReport, type TrialRun, type TrialSpec } from "./domain";

export function renderAXReport(
  spec: TrialSpec,
  run: TrialRun,
  options: { evidenceMode?: string } = {},
): AXReport {
  const outcome = deriveTrialOutcome(spec.acceptanceCriteria, run.graderResults);
  const expected = new Set(spec.acceptanceCriteria);
  const failed = run.graderResults.filter(
    (result) => expected.has(result.criterion) && result.outcome === "failed",
  );
  const unresolved = run.graderResults.filter(
    (result) => expected.has(result.criterion) && result.outcome === "inconclusive",
  );
  const missingCriteria = spec.acceptanceCriteria.filter(
    (criterion) => !run.graderResults.some((result) => result.criterion === criterion),
  );
  const contractWarnings = spec.acceptanceCriteria.flatMap((criterion) => {
    const count = run.graderResults.filter((result) => result.criterion === criterion).length;
    if (count === 0) return [`Missing grader result for: ${criterion}`];
    if (count > 1) return [`Expected one grader result for "${criterion}" but received ${count}.`];
    return [];
  });
  for (const result of run.graderResults) {
    if (!expected.has(result.criterion)) {
      contractWarnings.push(`Unexpected grader result for: ${result.criterion}`);
    }
  }
  const resultLines = [
    ...run.graderResults.map(
      (result) =>
        `| ${result.outcome.toUpperCase()} | ${result.criterion} | ${result.detail} | ${result.evidenceIds.join(", ")} |`,
    ),
    ...missingCriteria.map(
      (criterion) =>
        `| INCONCLUSIVE | ${criterion} | No grader result was produced. | No evidence |`,
    ),
  ].join("\n");
  const unresolvedLines = [
    ...unresolved.map((result) => `- ${result.criterion}: ${result.detail}`),
    ...contractWarnings.map((warning) => `- ${warning}`),
  ];

  return {
    runId: run.id,
    outcome,
    markdown: `# Agent Experience Report\n\n${options.evidenceMode ? `## Evidence Mode\n\n${options.evidenceMode}\n\n` : ""}## Outcome\n\n**${outcome.toUpperCase()}** for \`${spec.title}\` (run \`${run.id}\`).\n\n## Frozen Inputs\n\n- Trial specification: \`${spec.id}\`\n- Starter repository: ${spec.starterRepository.source} @ \`${spec.starterRepository.revision}\`\n- Resources: ${spec.resources.map((resource) => resource.locator).join(", ")}\n\n## Deterministic Results\n\n| Result | Criterion | Detail | Evidence |\n|---|---|---|---|\n${resultLines}\n\n## Deterministic Failures\n\n${failed.length === 0 ? "No deterministic acceptance criterion failed." : failed.map((result) => `- ${result.criterion}: ${result.detail}`).join("\n")}\n\n## Unresolved Verification\n\n${unresolvedLines.length === 0 ? "All frozen criteria reached exactly one deterministic result." : `${unresolvedLines.join("\n")}\n\nAn inconclusive result means there is not enough deterministic evidence. It is not a documentation failure.`}\n\n## Evidence\n\n${run.evidence.map((evidence) => `- \`${evidence.id}\` (${evidence.kind}, ${evidence.mediaType})`).join("\n")}\n`,
  };
}
