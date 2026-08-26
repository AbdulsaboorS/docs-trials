import {
  checkIds,
  checkTitles,
  countByOutcome,
  type CheckResult,
  type Outcome,
  type UngradedObservation,
} from "./outcome";
import type { RunRecord } from "./run";

const symbols = {
  passed: "PASS",
  failed: "FAIL",
  inconclusive: "N/A ",
} satisfies Record<Outcome, string>;

/** `null` means omit the line. `""` means keep an intentional blank line. */
type Line = string | null;

export function renderReport(record: RunRecord): string {
  if (record.status !== "verified") {
    throw new Error("Cannot render a report before verification runs.");
  }
  const verification = record.verification;
  const { results, outcome } = verification;
  const omitted = verification.omittedChecks;
  const totals = countByOutcome(results);
  const missing = checkIds.filter(
    (id) => !results.some((entry) => entry.id === id) && !omitted.some((entry) => entry.id === id),
  );
  const failed = results.filter((entry) => entry.outcome === "failed");
  const unresolved = results.filter((entry) => entry.outcome === "inconclusive");
  const ungraded = verification.ungradedObservations ?? [];
  const durationMs = Date.parse(verification.completedAt) - Date.parse(verification.startedAt);

  const lines: Line[] = [
    "# Agent Experience Report",
    "",
    `**BASELINE ${outcome.toUpperCase()}**`,
    "",
    "**Task fulfillment was not verified.**",
    "",
    `- Trial: ${record.manifest.title}`,
    `- Run: \`${record.runId}\``,
    `- Checks: ${totals.passed} passed, ${totals.failed} failed, ${totals.inconclusive} inconclusive`,
    `- Verification time: ${formatDuration(durationMs)}`,
    `- Agent: ${record.manifest.agent ? `${record.manifest.agent.name}${record.manifest.agent.model ? ` (${record.manifest.agent.model})` : ""}` : "not declared"}`,
    `- Verifier: Docs Trials ${verification.verifier.cliVersion} (schema ${verification.verifier.schemaVersion}); ${formatRuntime(verification.verifier.runtime)}`,
    `- Prepared with: Docs Trials ${record.preparation.cliVersion} (schema ${record.preparation.schemaVersion}); ${formatRuntime(record.preparation.runtime)}`,
    `- Manifest digest: \`${record.manifestDigest.slice(0, 16)}\``,
    record.baselineRevision
      ? `- Baseline revision: \`${record.baselineRevision.slice(0, 12)}\``
      : null,
    "",
    "## Task",
    "",
    record.manifest.task,
    "",
    "## Documentation supplied",
    "",
    ...record.documentation.flatMap((doc) => {
      if (doc.status === "live") {
        return [
          `- ${doc.label}: live source ${doc.sourceUrl}`,
          `  Snapshot incomplete: ${doc.error}`,
          `  Attempted ${doc.retrievedAt}${doc.finalUrl ? `; final URL ${doc.finalUrl}` : ""}${doc.httpStatus ? `; HTTP ${doc.httpStatus}` : ""}${doc.contentType ? `; ${doc.contentType}` : ""}.`,
        ];
      }
      const attribution =
        doc.sourceType === "inline" ? "inline trial text" : `source ${doc.sourceUrl}`;
      return [
        `- ${doc.label}: [frozen copy](${doc.file}) (${attribution})`,
        `  Retrieved ${doc.retrievedAt}; ${doc.byteLength} bytes; ${doc.contentType}; SHA-256 \`${doc.sha256}\`${doc.httpStatus ? `; HTTP ${doc.httpStatus}` : ""}${doc.sourceType === "url" && doc.finalUrl !== doc.sourceUrl ? `; final URL ${doc.finalUrl}` : ""}.`,
      ];
    }),
    "",
    "## Baseline checks",
    "",
    "These are the only results Docs Trials produced. Each one is code that ran.",
    "",
    "| Result | Check | Detail | Evidence |",
    "|---|---|---|---|",
    ...results.map(
      (entry) =>
        `| ${symbols[entry.outcome]} | ${entry.title} | ${escapeCell(entry.detail)} | ${evidenceLinks(entry)} |`,
    ),
    ...missing.map(
      (id) =>
        `| ${symbols.inconclusive} | ${checkTitles[id]} | This check did not run. | None recorded. |`,
    ),
    "",
    ...failedSection(failed),
    ...unresolvedSection(unresolved, missing.length),
    ...omittedSection(omitted),
    ...ungradedSection(ungraded),
    ...goalsSection(record.manifest.goals),
    "## How to read this report",
    "",
    "- **PASS** means Docs Trials observed the required behaviour.",
    "- **FAIL** means Docs Trials observed behaviour that contradicts the check.",
    "- **N/A** means there was not enough evidence to decide. It is not a documentation finding.",
    "",
    "The baseline checks are generic. They test that the integration installs, builds, boots,",
    "loads, renders visible content, loads browser assets, and does not expose a detected",
    "credential in captured same-origin content. They do not test whether the",
    "application fulfils the task. Docs Trials will not claim otherwise.",
  ];

  return `${lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function omittedSection(omitted: Array<{ id: CheckResult["id"]; reason: string }>): string[] {
  if (omitted.length === 0) return [];
  return [
    "## Omitted checks",
    "",
    ...omitted.map((entry) => `- **${checkTitles[entry.id]}** ${entry.reason}`),
    "",
    "These checks did not apply to the declared lifecycle and received no outcome.",
    "",
  ];
}

function ungradedSection(observations: UngradedObservation[]): string[] {
  if (observations.length === 0) return [];
  return [
    "## Ungraded observations",
    "",
    ...observations.map(
      (observation) => `- ${observation.detail} Evidence: ${evidenceLinks(observation)}`,
    ),
    "",
    "These facts did not change a baseline check result.",
    "",
  ];
}

function failedSection(failed: CheckResult[]): string[] {
  if (failed.length === 0) return ["## Observed failures", "", "No baseline check failed.", ""];
  return [
    "## Observed failures",
    "",
    ...failed.map((entry) => `- **${entry.title}** ${entry.detail}`),
    "",
    "Read the available evidence before attributing any of this",
    "to the documentation. A failure here is a fact about the run, not yet a finding.",
    "",
  ];
}

function unresolvedSection(unresolved: CheckResult[], missingCount: number): Line[] {
  if (unresolved.length === 0 && missingCount === 0) return [];
  return [
    "## Unresolved checks",
    "",
    ...unresolved.map((entry) => `- **${entry.title}** ${entry.detail}`),
    missingCount > 0 ? `- ${missingCount} check(s) never ran.` : null,
    "",
    "An unresolved check means Docs Trials lacked evidence. It does not mean the",
    "documentation failed.",
    "",
  ];
}

function goalsSection(goals: string[]): string[] {
  if (goals.length === 0) return [];
  return [
    "## Author goals — not verified",
    "",
    "The manifest author listed these outcomes. Docs Trials did **not** check any of them.",
    "They appear here for context only.",
    "",
    ...goals.map((goal) => `- ${goal}`),
    "",
  ];
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatRuntime(runtime: RunRecord["preparation"]["runtime"]): string {
  return `${runtime.nodeVersion} on ${runtime.platform} ${runtime.release} (${runtime.arch})`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function evidenceLinks(entry: Pick<CheckResult, "evidenceIds">): string {
  return entry.evidenceIds.length === 0
    ? "None recorded."
    : entry.evidenceIds.map((id) => `[${id}](evidence/${id}.txt)`).join(", ");
}
