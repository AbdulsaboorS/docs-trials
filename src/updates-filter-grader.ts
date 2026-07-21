import type { GraderResult } from "./domain";
import { updatesFilterCriteria } from "./fixture";

export type UpdatesFilterObservations = {
  headingVisible: boolean;
  initialUpdateCount: number;
  initialUpdateText: string;
  platformUpdateCount: number;
  platformUpdateText: string;
  emptyMessageVisible: boolean;
  consoleMessages: string[];
  networkFailures: string[];
  unexpectedExternalRequests: string[];
};

export function evaluateUpdatesFilterObservations(
  observations: UpdatesFilterObservations,
): GraderResult[] {
  return [
    result(
      updatesFilterCriteria.initial,
      observations.headingVisible &&
        observations.initialUpdateCount === 3 &&
        observations.initialUpdateText.includes("Faster previews") &&
        observations.initialUpdateText.includes("Clearer evidence") &&
        observations.initialUpdateText.includes("Safer trial limits"),
    ),
    result(
      updatesFilterCriteria.filter,
      observations.platformUpdateCount === 1 &&
        observations.platformUpdateText.includes("Faster previews") &&
        !observations.platformUpdateText.includes("Clearer evidence") &&
        !observations.platformUpdateText.includes("Safer trial limits"),
    ),
    result(updatesFilterCriteria.empty, observations.emptyMessageVisible),
    result(updatesFilterCriteria.network, observations.unexpectedExternalRequests.length === 0),
    result(
      updatesFilterCriteria.errors,
      observations.consoleMessages.length === 0 && observations.networkFailures.length === 0,
    ),
  ];
}

function result(criterion: string, passed: boolean): GraderResult {
  return {
    criterion,
    outcome: passed ? "passed" : "failed",
    detail: passed
      ? "Browser grader observed the expected state."
      : "Browser grader did not observe the expected state.",
    evidenceIds: ["browser-session"],
  };
}
