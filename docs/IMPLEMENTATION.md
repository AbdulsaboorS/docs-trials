# Implementation Plan

## Principle

Build the narrowest path that creates a real report. Do not start with a polished dashboard, multi-agent system, or generalized plugin framework.

## Phase 0: Verify External Interfaces

Before adding product code, retrieve current documentation and capture a dated note for:

- `@cloudflare/think` and its supported coding-agent harness pattern;
- Agents SDK persistence and streaming model;
- Sandbox SDK workspace, preview, lifecycle, and secrets APIs;
- Browser Run automation, sessions, recordings, and independent browser contexts;
- Artifacts repository, fork, token, and event APIs;
- Workflows retry, timeout, and step APIs;
- Kumo and Tailwind CSS v4 integration.

Create a short entry for each in `research/platform-capabilities.md`. Do not invent APIs from memory.

## Phase 1: Scaffold

Create a strict TypeScript `pnpm` project with:

- Worker application entry point;
- test runner;
- linting and formatting;
- `typecheck`, `test`, `lint`, and `build` scripts;
- configuration validation;
- an environment type or schema that separates public configuration from secrets.

Do not choose a monorepo until the sandbox runner or dashboard must independently deploy.

## Phase 2: Trial Domain

Implement validated domain schemas and tests for:

```txt
TrialSpec
TrialRun
TrialEvent
Evidence
GraderResult
AXReport
```

Add a checked-in RealtimeKit trial fixture with placeholder secret references only. Freeze resource manifests by URL and revision or retrieval timestamp.

## Phase 3: Headless Evidence Path

Implement a command or local endpoint that:

1. creates a `TrialRun` from the fixture;
2. records phase events;
3. executes a deterministic mock agent or fixture workspace;
4. records build and preview results;
5. invokes a test-double browser grader;
6. generates `grader-results.json` and `AX.md`.

This phase proves the data and report contract before external product integration.

## Phase 4: Real Agent And Sandbox

Replace the mock executor with the controlled Think coding agent and Sandbox workspace. Enforce resource allowlisting, command timeouts, output limits, secret redaction, and a terminal trial state.

At this point, verify a trivial non-RealtimeKit fixture before introducing media complexity.

The frozen trivial fixture is `updates-filter-smoke-v1`. It uses the built-in
`fixtures/updates-filter-starter/` React workspace and deterministic checks for
initial content, topic filtering, an empty state, and browser errors. This is a
platform smoke test, not a documentation assessment.

The controlled integration is prepared behind disabled endpoints: Think has
approved fetch/read tools, source-file-only writes, and bounded turns; Sandbox
uses one RPC session, immutable lifecycle files, script-disabled installation,
bounded lifecycle commands, port readiness, tunnels, and cleanup; Browser Run
blocks external runtime requests and produces deterministic three-state
results. Artifacts repository creation, versioned file mutation, and
control-plane deletion are confirmed by a standalone live spike. Binding-driven
Workflow persistence and the wider cloud path remain unvalidated.

## Phase 5: Browser Verification

Implement the RealtimeKit two-participant Browser Run grader. Treat each acceptance criterion in [`MVP.md`](MVP.md) as an independently reported result. Persist recording and screenshot references with redaction-aware metadata.

## Phase 6: Durable Orchestration And Evidence Storage

Move phase execution into Workflows and persist complete trial packages in Artifacts after confirming current access and API shape. Add resumability and idempotency only where an actual restart boundary requires it.

Before exposing run creation, enforce the admission, budget, cancellation, and
retention gates in [ADR 0007](decisions/0007-cloud-run-admission-controls.md).

## Phase 7: Dashboard

Implement the catalog, run setup, live timeline, and report screens using Kumo and Tailwind v4. The UI should consume the same events and report files produced by the headless path.

## Phase 8: Comparison Variant

Add exactly one controlled comparison: baseline docs-only against docs-plus-skill. Repeat runs and display raw results, not only a synthetic score.

## Definition Of Done For First Demo

- A maintainer can run the curated RealtimeKit task from a fixed specification.
- The coding agent works in an isolated Sandbox workspace.
- Browser Run verifies two browser participants against deterministic criteria.
- Evidence and source are preserved for a run.
- A portable `AX.md` links every finding to observed evidence.
- A second run can be started from the same frozen inputs.
