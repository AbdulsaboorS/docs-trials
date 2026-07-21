import type { GraderResult } from "./domain";
import { updatesFilterCriteria } from "./fixture";
import { redact } from "./redact";

const maxBrowserMessages = 100;
const maxBrowserMessageBytes = 200_000;
const maxBrowserMessageBytesEach = 2_000;

export type BrowserMessageBudget = { count: number; bytes: number };

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

export function appendBoundedBrowserMessage(
  target: string[],
  value: string,
  budget: BrowserMessageBudget,
): void {
  if (budget.count >= maxBrowserMessages || budget.bytes >= maxBrowserMessageBytes) return;
  const remaining = Math.min(maxBrowserMessageBytesEach, maxBrowserMessageBytes - budget.bytes);
  const encoded = new TextEncoder().encode(redact(value));
  let end = Math.min(encoded.byteLength, remaining);
  let message = "";
  while (end > 0) {
    try {
      message = new TextDecoder("utf-8", { fatal: true }).decode(encoded.slice(0, end));
      break;
    } catch {
      end -= 1;
    }
  }
  target.push(message);
  budget.count += 1;
  budget.bytes += end;
}

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
