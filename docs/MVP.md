# MVP: RealtimeKit Video Room Trial

## Goal

Prove the complete Docs Trials loop with one curated integration task and one resource variant. The output must be a reproducible pass/fail result and an `AX.md` report.

Before introducing RealtimeKit credentials and media behavior, the controlled
cloud path uses the internal `updates-filter-smoke-v1` fixture. That fixture
proves Think, Sandbox, Browser Run, Workflows, Artifacts, and reporting with a
small no-credential React task. It validates the platform and must not be
presented as a documentation-quality finding.

## Task

> Using only the supplied RealtimeKit documentation and starter repository, build a React application that allows two browser participants to join the same video room, publish camera and microphone media, see each other, leave, and rejoin.

The final implementation must preserve the authentication boundary specified by the task environment. Persistent credentials must not be bundled into browser-delivered source.

## MVP Resource Variant

The initial variant is **approved RealtimeKit public documentation only**. The precise URL list and source revision must be frozen in the trial specification before execution.

Later comparisons may add a skill, MCP server, API schema, or blueprint. They are out of scope until the baseline succeeds end to end.

## Trial Inputs

```ts
type TrialSpec = {
  id: string;
  title: string;
  task: string;
  starterRepository: {
    revision: string;
    source: string;
  };
  resources: Array<{
    kind: "website" | "markdown" | "mcp" | "skill" | "blueprint";
    locator: string;
    revision?: string;
  }>;
  runtime: {
    installCommand: string;
    buildCommand: string;
    startCommand: string;
  };
  acceptanceCriteria: string[];
};
```

## Deterministic Acceptance Criteria

The first grader must evaluate the following criteria. Exact selectors, endpoints, and expected event shapes belong in the eventual task fixture.

1. The generated project installs and builds successfully.
2. The generated application starts and exposes a reachable preview URL.
3. Participant A can join the configured test room.
4. Participant B can join the same room in a separate browser context.
5. Each participant's UI reflects that two participants are present.
6. Each participant can publish camera and microphone media using supplied test capabilities or controlled substitutes.
7. Leaving removes a participant from the other participant's UI.
8. Rejoining restores two-participant state.
9. No persistent token or room credential is present in browser-delivered JavaScript, source maps, DOM content, screenshots, or saved logs.
10. The browser console and network checks contain no unhandled application error that invalidates the flow.

## Explicitly Deferred

- Physical-device validation, including iOS Safari.
- Quality scoring for audio/video streams.
- Cross-browser matrix.
- Product scalability or load testing.
- Automatic remediation patches.
- Arbitrary user-authored tasks.

## Required Outputs

Every completed or failed trial must emit:

```txt
trial.json            Frozen task, resources, versions, and run configuration
agent-trace.jsonl     Ordered agent actions and tool results
generated-source/     The produced application revision or reference
commands.jsonl        Install, build, start, and test output metadata
browser-evidence/     Screenshots, recording reference, console/network summaries
grader-results.json   Deterministic criteria and result details
AX.md                 Human-readable report
```

Each criterion records `passed`, `failed`, or `inconclusive`. Inconclusive
means the verifier lacked enough evidence; it is not a documentation failure.

## Exit Criteria

The MVP is complete when a maintainer can run the curated trial twice from the same inputs and receive preserved evidence plus a deterministic result for each run.
