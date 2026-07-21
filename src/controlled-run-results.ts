import type { GraderResult } from "./domain";
import { updatesFilterCriteria } from "./fixture";

export type BrowserGrade = {
  sessionId: string;
  consoleMessages: string[];
  networkFailures: string[];
  unexpectedExternalRequests?: string[];
  screenshotCaptured: boolean;
  screenshot?: Uint8Array;
  results: GraderResult[];
};

export type SmokeCommandResult = {
  phase: "install" | "build" | "start";
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SmokeBuildResult = {
  install: SmokeCommandResult;
  build: SmokeCommandResult;
};

export type SmokePreviewResult =
  | { available: true; processId: string; url: string }
  | { available: false; detail: string; failureKind: "application" | "infrastructure" };

export function createSmokeGraderResults(
  build: SmokeBuildResult,
  preview: SmokePreviewResult,
  browser: BrowserGrade,
): GraderResult[] {
  return [
    {
      criterion: updatesFilterCriteria.build,
      outcome: build.install.success && build.build.success ? "passed" : "failed",
      detail:
        build.install.success && build.build.success
          ? "Sandbox dependency installation and build completed successfully."
          : "Sandbox dependency installation or build exited unsuccessfully.",
      evidenceIds: ["command-build"],
    },
    {
      criterion: updatesFilterCriteria.preview,
      outcome: preview.available
        ? "passed"
        : preview.failureKind === "application"
          ? "failed"
          : "inconclusive",
      detail: preview.available
        ? "Sandbox preview became reachable before verification."
        : preview.detail,
      evidenceIds: ["preview"],
    },
    ...browser.results,
  ];
}

export function unavailableBrowserGrade(detail: string): BrowserGrade {
  const criteria = Object.values(updatesFilterCriteria).filter(
    (criterion) =>
      criterion !== updatesFilterCriteria.build && criterion !== updatesFilterCriteria.preview,
  );
  return {
    sessionId: "unavailable",
    consoleMessages: [],
    networkFailures: [],
    unexpectedExternalRequests: [],
    screenshotCaptured: false,
    results: criteria.map((criterion) => ({
      criterion,
      outcome: "inconclusive",
      detail: `Browser verification was unavailable: ${detail}`,
      evidenceIds: ["browser-session"],
    })),
  };
}
