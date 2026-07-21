# Controlled-Cloud Smoke Trial

## Purpose

`updates-filter-smoke-v1` is the first no-credential task for validating the
controlled cloud pipeline. It proves that Docs Trials can move one frozen task
through Think, Sandbox, Browser Run, Workflows, Artifacts, and AX.md reporting
before RealtimeKit adds authentication and media complexity.

This is an internal platform test. Its result must not be presented as a score
or finding about React's documentation.

## Frozen Task

The agent receives the incomplete built-in React starter at
`fixtures/updates-filter-starter/`, the task in `src/fixture.ts`, and only these
approved documentation pages:

- `https://react.dev/learn/state-a-components-memory`
- `https://react.dev/learn/conditional-rendering`

It must display three supplied updates, visible topic filters, and a
`No updates found.` state for the empty Archived topic. The task uses no login,
secret, external service, or runtime data request.

## Deterministic Checks

1. The project installs and builds successfully.
2. The preview starts and is reachable.
3. The Updates page initially shows all three supplied updates.
4. The Platform filter shows only `Faster previews`.
5. The Archived filter shows `No updates found.`.
6. The page makes no unexpected external runtime data request.
7. The browser records no unhandled console error or server response at or
   above status 500.

The frozen task requires accessible headings, filter buttons, update articles,
and visible text. The browser judges those semantics and behavior rather than
the page's visual style.

## Required Evidence

- frozen trial specification and retrieved resource metadata;
- starter revision and generated source revision;
- bounded agent submissions, tool calls, and results;
- redacted install, build, and preview command output;
- preview reference and lifecycle events;
- Browser Run screenshot, console summary, network-failure summary, and session
  identifier. Cloudflare recording is disabled so its provider retention cannot
  exceed the prototype policy;
- criterion-level results and aggregate outcome;
- rendered `AX.md`.

No cloud execution occurs until Artifacts access and ADR 0007's admission
controls are live-validated.

## Prepared Implementation

The disabled cloud path now compiles the following integration:

- Access identity validation and per-user atomic admission;
- fixed model, Workflow, Sandbox, Browser Run, output, and evidence ceilings;
- Think submission with an idempotency key, approved documentation fetches, and
  workspace reads plus writes limited to `src/App.jsx` and `src/styles.css`;
- an RPC Sandbox session populated from the frozen built-in starter;
- bounded install/build commands, a port-4173 preview process, and quick tunnel;
- deterministic Browser Run grading that fails observed application defects,
  marks infrastructure interruptions inconclusive, ignores hidden articles,
  and blocks non-preview runtime requests;
- complete redacted package assembly and a seven-day Artifact retention
  deadline; Think messages and submissions are purged during run cleanup;
- Workflow termination, Think cancellation, Sandbox destruction, and admission
  release only after resource cleanup succeeds.

Artifact package contents are intentionally discarded after their manifest is
validated. API entitlement is confirmed, but no cloud evidence is saved until
the real adapter passes namespace, repository, versioned-write, read, and
deletion tests.
