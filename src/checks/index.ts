import type { Manifest } from "../core/manifest";
import { result, type CheckId, type CheckResult } from "../core/outcome";
import { runCommand, succeeded, type CommandOutcome } from "./command";
import { observePage, type PageObservation } from "./page";
import { startPreview } from "./preview";

export type BaselineEvidence = { id: string; content: string };

export type BaselineRun = {
  results: CheckResult[];
  evidence: BaselineEvidence[];
  ungradedObservations: string[];
  omittedChecks: Array<{ id: CheckId; reason: string }>;
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
  const ungradedObservations: string[] = [];
  const omittedChecks: BaselineRun["omittedChecks"] = [];
  const { run } = manifest;

  report(`install: ${run.install}`);
  const install = await runCommand(
    run.install,
    workspace,
    run.commandTimeoutSeconds,
    manifest.allowedEnvironment,
  );
  evidence.push({ id: "install", content: install.output });
  results.push(commandResult("install", install, "Dependency installation"));

  let build: CommandOutcome | undefined;
  if (!run.build) {
    omittedChecks.push({ id: "build", reason: "The manifest declares no build command." });
  } else if (!succeeded(install)) {
    results.push(
      result("build", "inconclusive", "Skipped because dependency installation did not succeed.", [
        "install",
      ]),
    );
  } else {
    report(`build: ${run.build}`);
    build = await runCommand(
      run.build,
      workspace,
      run.commandTimeoutSeconds,
      manifest.allowedEnvironment,
    );
    evidence.push({ id: "build", content: build.output });
    results.push(commandResult("build", build, "Build"));
  }

  const buildBlocked = !succeeded(install) || (build !== undefined && !succeeded(build));
  if (buildBlocked) {
    const detail = "Skipped because the project did not install and build.";
    const blockingEvidence = !succeeded(install) ? ["install"] : ["build"];
    results.push(result("boot", "inconclusive", detail, blockingEvidence));
    results.push(...browserUnavailable(detail, blockingEvidence));
    return { results, evidence, ungradedObservations, omittedChecks };
  }

  report(`boot: ${run.start}`);
  const preview = await startPreview(
    run.start,
    workspace,
    run.url,
    run.startupTimeoutSeconds,
    manifest.allowedEnvironment,
  );
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
      return { results, evidence, ungradedObservations, omittedChecks };
    }

    const ownershipDetail = `${run.url} changed listener ownership after the start command answered, so Docs Trials cannot trust the observed page.`;
    if (!(await preview.confirmOwnership())) {
      results.push(result("boot", "inconclusive", ownershipDetail, ["boot"]));
      results.push(...browserUnavailable(ownershipDetail, ["boot"]));
      return { results, evidence, ungradedObservations, omittedChecks };
    }

    results.push(
      result("boot", "passed", `${run.url} answered with HTTP ${preview.status}.`, ["boot"]),
    );

    report(`observe: ${run.url}`);
    const page = await observePage(run.url, 45, run.observationWindowSeconds);
    evidence.push({ id: "browser", content: describe(page) });

    if (!(await preview.confirmOwnership())) {
      const bootIndex = results.findIndex((entry) => entry.id === "boot");
      results[bootIndex] = result("boot", "inconclusive", ownershipDetail, ["boot"]);
      results.push(...browserUnavailable(ownershipDetail, ["boot", "browser"]));
      return { results, evidence, ungradedObservations, omittedChecks };
    }

    if (!page.available) {
      results.push(...browserUnavailable(page.detail, ["browser"]));
      return { results, evidence, ungradedObservations, omittedChecks };
    }

    results.push(pageLoadResult(page));
    results.push(visibleContentResult(page));
    results.push(consoleResult(page));
    results.push(resourceLoadResult(page));
    results.push(serverErrorResult(page));
    results.push(secretsResult(page));
    results.push(egressResult(page, manifest.allowedOrigins));
    ungradedObservations.push(...page.ungradedObservations);
    return { results, evidence, ungradedObservations, omittedChecks };
  } finally {
    const cleanupSucceeded = await preview.stop();
    if (!cleanupSucceeded) {
      evidence.push({
        id: "cleanup",
        content: "The preview process group remained after SIGTERM and SIGKILL cleanup attempts.",
      });
      ungradedObservations.push(
        "The preview process group could not be fully terminated after browser observation.",
      );
      const bootIndex = results.findIndex((entry) => entry.id === "boot");
      const boot = results[bootIndex];
      if (boot) {
        results[bootIndex] =
          boot.outcome === "passed"
            ? result(
                "boot",
                "inconclusive",
                "The application answered, but its preview process group could not be fully terminated.",
                ["boot", "cleanup"],
              )
            : { ...boot, evidenceIds: [...new Set([...boot.evidenceIds, "cleanup"])] };
      }
    }
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
    return result(
      id,
      "inconclusive",
      `${label} exceeded its time limit, so no exit result was observed.`,
      [id],
    );
  }
  if (command.signalCode !== null) {
    return result(
      id,
      "inconclusive",
      `${label} ended after signal ${command.signalCode}, so Docs Trials cannot attribute the termination to the project.`,
      [id],
    );
  }
  if (!command.cleanupSucceeded) {
    return result(
      id,
      "inconclusive",
      `${label} exited, but its process group could not be fully terminated.`,
      [id],
    );
  }
  if (command.exitCode === 127) {
    return result(
      id,
      "inconclusive",
      `${label} exited with code 127. Docs Trials cannot distinguish unavailable host tooling from an intentional exit.`,
      [id],
    );
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
  if (total === 0 && page.droppedConsoleErrors > 0) {
    return result(
      "console-errors",
      "inconclusive",
      `${page.droppedConsoleErrors} additional browser console error${page.droppedConsoleErrors === 1 ? " was" : "s were"} not retained after the evidence limit was reached.`,
      ["browser"],
    );
  }
  if (total === 0) {
    return result("console-errors", "passed", "No uncaught or application console error.", [
      "browser",
    ]);
  }
  const first = [...page.pageErrors, ...page.consoleErrors][0] ?? "";
  return result(
    "console-errors",
    "failed",
    `${total} application error${total === 1 ? "" : "s"}. First: ${first}`,
    ["browser"],
  );
}

function visibleContentResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (!page.navigated) {
    return result(
      "visible-content",
      "inconclusive",
      "The page did not load, so its rendered content could not be inspected.",
      ["browser"],
    );
  }
  if (page.visibleContent === undefined) {
    return result(
      "visible-content",
      "inconclusive",
      page.visibleContentDetail ?? "The rendered page could not be inspected.",
      ["browser"],
    );
  }
  return page.visibleContent === null
    ? result(
        "visible-content",
        "failed",
        "The page rendered no visible text or meaningful visual surface.",
        ["browser"],
      )
    : result(
        "visible-content",
        "passed",
        `The page rendered visible ${page.visibleContent.kind.replace("-", " ")}.`,
        ["browser"],
      );
}

function resourceLoadResult(page: Extract<PageObservation, { available: true }>): CheckResult {
  if (page.resourceFailures.length > 0) {
    const count = page.resourceFailures.length;
    return result(
      "resource-loads",
      "failed",
      `${count} same-origin browser asset failure${count === 1 ? "" : "s"}. First: ${page.resourceFailures[0]}`,
      ["browser"],
    );
  }
  if (page.pendingResources.length > 0) {
    const count = page.pendingResources.length;
    return result(
      "resource-loads",
      "inconclusive",
      `${count} same-origin browser asset${count === 1 ? " was" : "s were"} still pending. First: ${page.pendingResources[0]}`,
      ["browser"],
    );
  }
  if (!page.navigated) {
    return result(
      "resource-loads",
      "inconclusive",
      "The page did not load, so browser assets could not be observed.",
      ["browser"],
    );
  }
  return result("resource-loads", "passed", "Same-origin browser assets loaded.", ["browser"]);
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
  const { contentScan } = page;
  if (contentScan.findings.length > 0) {
    const first = contentScan.findings[0];
    return result(
      "client-secrets",
      "failed",
      `${contentScan.findings.length} credential-shaped value(s) served to the browser. First: ${first?.kind} ${first?.sample} in ${first?.asset}`,
      ["browser"],
    );
  }
  if (contentScan.gaps.length > 0) {
    return result(
      "client-secrets",
      "inconclusive",
      `${contentScan.gaps.length} same-origin response body capture gap(s). First: ${contentScan.gaps[0]}`,
      ["browser"],
    );
  }
  const count = contentScan.responsesScanned;
  return count === 0
    ? result("client-secrets", "inconclusive", "No same-origin response body was captured.", [
        "browser",
      ])
    : result(
        "client-secrets",
        "passed",
        `No credential-shaped value in ${count} complete same-origin response${count === 1 ? "" : "s"} (${contentScan.bytesScanned} bytes).`,
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
  const allowedOrigins = new Set(allowed.map(normalizeNetworkOrigin));
  const unexpected = page.externalOrigins.filter((origin) => !allowedOrigins.has(origin));
  if (unexpected.length === 0) {
    return result(
      "network-egress",
      "passed",
      `The page contacted only declared origins: ${page.externalOrigins.join(", ")}`,
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

function normalizeNetworkOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.origin;
}

function browserUnavailable(detail: string, evidenceIds: string[]): CheckResult[] {
  const affected = [
    "page-load",
    "visible-content",
    "console-errors",
    "resource-loads",
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
      droppedConsoleErrors: page.droppedConsoleErrors,
      pageErrors: page.pageErrors,
      resourceFailures: page.resourceFailures,
      pendingResources: page.pendingResources,
      serverErrors: page.serverErrors,
      externalOrigins: page.externalOrigins,
      ungradedObservations: page.ungradedObservations,
      contentScan: page.contentScan,
      visibleContent: page.visibleContent,
      visibleContentDetail: page.visibleContentDetail,
      bodyTextSample: page.bodyTextSample,
    },
    null,
    2,
  );
}

function lastLine(output: string): string {
  return output.trimEnd().split("\n").at(-1) ?? "";
}
