import { docLabel } from "./manifest";
import { checkIds, checkTitles, countByOutcome, type CheckResult, type Outcome } from "./outcome";
import type { RunRecord } from "./run";

const symbols: Record<Outcome, string> = {
  passed: "PASS",
  failed: "FAIL",
  inconclusive: "N/A ",
};

/** `null` means omit the line. `""` means keep an intentional blank line. */
type Line = string | null;

export function renderReport(record: RunRecord): string {
  const verification = record.verification;
  if (!verification) throw new Error("Cannot render a report before verification runs.");
  const { results, outcome } = verification;
  const totals = countByOutcome(results);
  const missing = checkIds.filter((id) => !results.some((entry) => entry.id === id));
  const failed = results.filter((entry) => entry.outcome === "failed");
  const unresolved = results.filter((entry) => entry.outcome === "inconclusive");
  const durationMs = Date.parse(verification.completedAt) - Date.parse(verification.startedAt);

  const lines: Line[] = [
    "# Agent Experience Report",
    "",
    `**${outcome.toUpperCase()}** — ${record.manifest.title}`,
    "",
    `- Run: \`${record.runId}\``,
    `- Checks: ${totals.passed} passed, ${totals.failed} failed, ${totals.inconclusive} inconclusive`,
    `- Verification time: ${formatDuration(durationMs)}`,
    `- Agent: ${record.manifest.agent ? `${record.manifest.agent.name}${record.manifest.agent.model ? ` (${record.manifest.agent.model})` : ""}` : "not declared"}`,
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
    ...record.manifest.docs.map((doc) => `- ${docLabel(doc)}`),
    "",
    "## Baseline checks",
    "",
    "These are the only results Docs Trials produced. Each one is code that ran.",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...results.map(
      (entry) => `| ${symbols[entry.outcome]} | ${entry.title} | ${escapeCell(entry.detail)} |`,
    ),
    ...missing.map(
      (id) => `| ${symbols.inconclusive} | ${checkTitles[id]} | This check did not run. |`,
    ),
    "",
    ...failedSection(failed),
    ...unresolvedSection(unresolved, missing.length),
    ...goalsSection(record.manifest.goals),
    "## How to read this report",
    "",
    "- **PASS** means Docs Trials observed the required behaviour.",
    "- **FAIL** means Docs Trials observed behaviour that contradicts the check.",
    "- **N/A** means there was not enough evidence to decide. It is not a documentation finding.",
    "",
    "The baseline checks are generic. They test that the integration installs, builds, boots,",
    "loads, and does not leak credentials to the browser. They do not test whether the",
    "application fulfils the task. Docs Trials will not claim otherwise.",
  ];

  return `${lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function failedSection(failed: CheckResult[]): string[] {
  if (failed.length === 0) return ["## Observed failures", "", "No baseline check failed.", ""];
  return [
    "## Observed failures",
    "",
    ...failed.map((entry) => `- **${entry.title}** ${entry.detail}`),
    "",
    "Read the recorded command output and browser evidence before attributing any of this",
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

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
