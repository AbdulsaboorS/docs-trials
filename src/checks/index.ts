import type { Manifest } from "../core/manifest";
import { result, type CheckResult } from "../core/outcome";
import { runCommand, succeeded, type CommandOutcome } from "./command";
import { observePage, type PageObservation } from "./page";
import { startPreview } from "./preview";
import { findSecrets } from "./secrets";

export type BaselineEvidence = { id: string; content: string };

export type BaselineRun = {
  results: CheckResult[];
  evidence: BaselineEvidence[];
};

type Reporter = (message: string) => void;

/**
 * Runs the baseline suite: install, build, boot, load, errors, secrets, egress.
 *
 * Every check is generic. None of it is derived from the task text, so it works
 * on any web application without the author writing a grader. When a step
 * cannot run because an earlier one failed, the dependent check is
 * inconclusive rather than failed. Docs Trials only reports a failure it saw.
 */
export async function runBaseline(
  manifest: Manifest,
  workspace: string,
  report: Reporter = () => {},
): Promise<BaselineRun> {
  const results: CheckResult[] = [];
  const evidence: BaselineEvidence[] = [];
  const { run } = manifest;

  report(`install: ${run.install}`);
  const install = await runCommand(run.install, workspace, run.commandTimeoutSeconds);
  evidence.push({ id: "install", content: install.output });
  results.push(commandResult("install", install, "Dependency installation"));

  let build: CommandOutcome | undefined;
  if (!run.build) {
    results.push(result("build", "inconclusive", "The manifest declares no build command.", []));
  } else if (!succeeded(install)) {
    results.push(
      result("build", "inconclusive", "Skipped because dependency installation did not succeed.", [
        "install",
      ]),
    );
  } else {
    report(`build: ${run.build}`);
    build = await runCommand(run.build, workspace, run.commandTimeoutSeconds);
    evidence.push({ id: "build", content: build.output });
    results.push(commandResult("build", build, "Build"));
  }

  const buildBlocked = !succeeded(install) || (build !== undefined && !succeeded(build));
  if (buildBlocked) {
    const detail = "Skipped because the project did not install and build.";
    results.push(result("boot", "inconclusive", detail, []));
    results.push(...browserUnavailable(detail, []));
    return { results, evidence };
  }

  report(`boot: ${run.start}`);
  const preview = await startPreview(run.start, workspace, run.url, run.startupTimeoutSeconds);
  evidence.push({ id: "boot", content: preview.output });

  try {
    if (!preview.available) {
      results.push(
        result(
          "boot",
          preview.reason === "application" ? "failed" : "inconclusive",
          preview.detail,
          ["boot"],
        ),
      );
      results.push(...browserUnavailable(preview.detail, ["boot"]));
      return { results, evidence };
    }

    results.push(
      result("boot", "passed", `${run.url} answered with HTTP ${preview.status}.`, ["boot"]),
    );

    report(`observe: ${run.url}`);
    const page = await observePage(run.url, 45);
    evidence.push({ id: "browser", content: describe(page) });

    if (!page.available) {
      results.push(...browserUnavailable(page.detail, ["browser"]));
      return { results, evidence };
    }

    results.push(pageLoadResult(page));
    results.push(consoleResult(page));
    results.push(serverErrorResult(page));
    results.push(secretsResult(page));
    results.push(egressResult(page, manifest.allowedOrigins));
    return { results, evidence };
  } finally {
    await preview.stop();
  }
}

function commandResult(
  id: "install" | "build",
  command: CommandOutcome,
  label: string,
): CheckResult {
  if (!command.ran) {
    return result(id, "inconclusive", `${label} could not start. ${lastLine(command.output)}`, [
      id,
    ]);
  }
  if (command.timedOut) {
    return result(id, "failed", `${label} exceeded its time limit.`, [id]);
  }
  return command.exitCode === 0
    ? result(id, "passed", `${label} completed in ${Math.round(command.durationMs / 1000)}s.`, [id])
    : result(id, "failed", `${label} exited with code ${command.exitCode}.`, [id]);
}

function pageLoadResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (!page.navigated)
    return result("page-load", "inconclusive", page.navigationDetail, ["browser"]);
  if (page.httpStatus !== undefined && page.httpStatus >= 400) {
    return result("page-load", "failed", page.navigationDetail, ["browser"]);
  }
  return result(
    "page-load",
    "passed",
    `The entry page returned HTTP ${page.httpStatus ?? 200}${page.title ? ` with title "${page.title}"` : ""}.`,
    ["browser"],
  );
}

function consoleResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (!page.navigated) {
    return result(
      "console-errors",
      "inconclusive",
      "The page did not load, so no console evidence exists.",
      ["browser"],
    );
  }
  const total = page.consoleErrors.length + page.pageErrors.length;
  const note = page.resourceErrors.length
    ? ` ${page.resourceErrors.length} resource load complaint(s) were recorded separately under network egress.`
    : "";
  if (total === 0) {
    return result("console-errors", "passed", `No uncaught or console error.${note}`, ["browser"]);
  }
  const first = [...page.pageErrors, ...page.consoleErrors][0] ?? "";
  return result(
    "console-errors",
    "failed",
    `${total} application error${total === 1 ? "" : "s"}. First: ${first}${note}`,
    ["browser"],
  );
}

function serverErrorResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (!page.navigated) {
    return result(
      "server-errors",
      "inconclusive",
      "The page did not load, so no responses were observed.",
      ["browser"],
    );
  }
  return page.serverErrors.length === 0
    ? result("server-errors", "passed", "No response returned a 5xx status.", ["browser"])
    : result(
        "server-errors",
        "failed",
        `${page.serverErrors.length} server error response(s). First: ${page.serverErrors[0]}`,
        ["browser"],
      );
}

function secretsResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (page.assets.length === 0) {
    return result("client-secrets", "inconclusive", "No browser-delivered asset was captured.", [
      "browser",
    ]);
  }
  const findings = findSecrets(page.assets);
  if (findings.length === 0) {
    return result(
      "client-secrets",
      "passed",
      `No credential-shaped value in ${page.assets.length} browser-delivered asset(s).`,
      ["browser"],
    );
  }
  const first = findings[0];
  return result(
    "client-secrets",
    "failed",
    `${findings.length} credential-shaped value(s) served to the browser. First: ${first?.kind} ${first?.sample} in ${first?.asset}`,
    ["browser"],
  );
}

function egressResult(
  page: Extract<PageObservation, { available: true }>,
  allowed: string[],
): CheckResult {
  if (!page.navigated) {
    return result(
      "network-egress",
      "inconclusive",
      "The page did not load, so no requests were observed.",
      ["browser"],
    );
  }
  if (page.externalOrigins.length === 0) {
    return result("network-egress", "passed", "The page contacted no external origin.", [
      "browser",
    ]);
  }
  const allowedOrigins = new Set(allowed.map((value) => new URL(value).origin));
  const unexpected = page.externalOrigins.filter((origin) => !allowedOrigins.has(origin));
  if (unexpected.length === 0) {
    return result(
      "network-egress",
      "passed",
      `The page contacted only declared origins: ${page.externalOrigins.join(", ")}`,
      ["browser"],
    );
  }
  if (allowedOrigins.size === 0) {
    return result(
      "network-egress",
      "inconclusive",
      `The page contacted ${unexpected.join(", ")}. Declare expected origins in \`allowedOrigins\` to make this check decisive.`,
      ["browser"],
    );
  }
  return result(
    "network-egress",
    "failed",
    `The page contacted undeclared origins: ${unexpected.join(", ")}`,
    ["browser"],
  );
}

function browserUnavailable(detail: string, evidenceIds: string[]): CheckResult[] {
  const affected = [
    "page-load",
    "console-errors",
    "server-errors",
    "client-secrets",
    "network-egress",
  ] as const;
  return affected.map((id) => result(id, "inconclusive", detail, evidenceIds));
}

function describe(page: PageObservation): string {
  if (!page.available) return page.detail;
  return JSON.stringify(
    {
      navigated: page.navigated,
      navigationDetail: page.navigationDetail,
      httpStatus: page.httpStatus,
      title: page.title,
      consoleErrors: page.consoleErrors,
      pageErrors: page.pageErrors,
      resourceErrors: page.resourceErrors,
      serverErrors: page.serverErrors,
      externalOrigins: page.externalOrigins,
      assetsCaptured: page.assets.map((asset) => asset.url),
      bodyTextSample: page.bodyTextSample,
    },
    null,
    2,
  );
}

function lastLine(output: string): string {
  return output.trimEnd().split("\n").at(-1) ?? "";
}
