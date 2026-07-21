# Architecture

## Guiding Principle

Separate execution, verification, explanation, and presentation. A model can make code changes and explain failures, but deterministic systems own the authoritative evidence and pass/fail decision.

## Target Components

```txt
Dashboard / API Worker
        |
        v
Trial coordinator (Workflow)
        |
        +--> Persistent trial state (Agents SDK / Durable Object)
        +--> Controlled coding agent (Think harness)
        |           |
        |           v
        |      Isolated workspace (Sandbox SDK)
        |           |
        |           v
        |      Preview application
        |
        +--> Browser Run deterministic grader
        |
        +--> Evidence repository (Artifacts)
        |
        +--> Analysis/report agent
                    |
                    v
                  AX.md
```

## Component Responsibilities

### Dashboard and API

The web application starts curated trials, streams progress, exposes evidence, and presents reports. It must not execute generated application code directly.

### Workflow Coordinator

Workflows own durable phase transitions, timeouts, retries, and terminal status. Planned phases:

```txt
prepare -> execute -> build -> preview -> verify -> report -> complete
```

Each phase writes an immutable event into the trial evidence stream.

### Persistent Trial State

Agents SDK provides the interactive agent state and live updates. A Durable Object may own per-trial coordination if strong ordering, session fan-out, or resumable UI connections require it. Do not introduce both until API requirements make the separation useful.

The first controlled-cloud implementation adds one narrowly scoped Durable
Object per authenticated identity for admission only. It atomically reserves a
single active run, its frozen limits, expiry, and cancellation flag. It does
not duplicate the Workflow event stream or Think session state.

### Coding Agent

The controlled agent has:

- the task contract;
- access only to resource adapters assigned to the trial;
- a workspace and shell within Sandbox;
- bounded tool and retry budgets;
- no permanent production secrets;
- a traceable tool surface.

It does not determine whether its own work passed.

### Sandbox SDK

Sandbox executes untrusted generated code, dependency installation, builds, and preview servers. Trial credentials must be short-lived and scoped to the test room. Sandbox lifecycle and network policy must be explicitly configured during implementation.

### Browser Run Grader

Browser Run owns browser-side verification. It opens independent participant contexts, performs the defined task flow, captures screenshots and a session recording, and produces structured evidence. The grader is code, not a free-form model prompt.

### Artifacts

Artifacts holds the immutable trial package: frozen inputs, generated source, trace, evidence, and report. One trial run maps to one versioned artifact repository. A separate clean Sandbox writes the package through Git using a short-lived repository-scoped token; the agent-controlled trial Sandbox never receives that credential.

### Analysis Agent

After deterministic grading, an analysis agent maps observed failures to the resources and agent actions that preceded them. Its output is advisory and must link to evidence. It cannot convert a failed deterministic criterion to a pass.

## Data Model

```txt
TrialSpec       Immutable task definition and resource variant
TrialRun        One execution of a TrialSpec
TrialEvent      Append-only phase, tool, command, and grader event
Evidence        Structured pointer or embedded redacted output
GraderResult    Criterion-level pass/fail with evidence references
AXReport        Derived human-readable report for a TrialRun
```

Each grader result is `passed`, `failed`, or `inconclusive`. A run passes only
when every frozen criterion passes exactly once. A proven deterministic failure
takes precedence; missing or incomplete evidence otherwise produces an
inconclusive run. See [ADR 0006](decisions/0006-three-state-grader-outcomes.md).

## Security Boundaries

- Docs Trials control plane never exposes long-lived credentials to the browser.
- Sandbox receives only short-lived, trial-scoped secrets.
- Generated application source, logs, DOM captures, screenshots, recordings, and network traces pass through redaction before durable storage.
- Browser Run sessions use synthetic users and test rooms.
- Trial variants must record exactly which resources were available to prevent accidental access to unapproved material.
- Cloud-run admission requires authenticated identity, an atomic quota check,
  one active run per user, immutable execution limits, cancellation, and a
  configured retention/deletion policy before paid work starts.
- Rate limiting and provider spending controls are defense in depth; they do
  not replace exact cross-product admission accounting.
- Cloudflare Access JWT validation establishes identity without an email
  allowlist. The prototype policy permits one active run per identity and uses
  a seven-day evidence-retention target.

## Decisions Deferred Until Retrieval

- Exact Think API and integration shape.
- Whether a Durable Object is required in the first vertical slice.
- Artifacts API availability and repository layout.
- Browser Run multi-context/session capabilities and media-device controls.
- Kumo's recommended application integration and component APIs.
