# ADR 0007: Gate Cloud Runs Behind Admission And Lifecycle Controls

## Status

Accepted

## Context

A controlled cloud run can consume model, Sandbox, Browser Run, Workflow, and
Artifacts resources. An unauthenticated or unbounded run endpoint would expose
paid compute, retain sensitive evidence without a clear policy, and make abuse
or accidental spending difficult to contain.

## Decision

Cloud execution remains disabled until all of these controls are enforced:

- authenticated user identity on every create, inspect, cancel, and evidence
  request;
- an atomic admission record that enforces per-user run and spending limits;
- one active run per user for the first release;
- an immutable per-run budget covering model steps, retries, Workflow duration,
  Sandbox lifetime, Browser Run duration, and evidence size;
- idempotent run creation so retries cannot start duplicate paid work;
- cancellation that stops future Workflow phases, terminates browser sessions
  and Sandbox processes, and records a terminal event;
- a configured, user-visible retention period plus a tested hard-delete path
  for source, logs, browser evidence, reports, and associated credentials;
- redaction before durable persistence and authorization checks before every
  evidence read;
- rate limiting and abuse checks as defense in depth, not as substitutes for
  exact quota accounting.

Internal prototype evidence uses a seven-day retention target. Any change to
that duration must update the frozen run policy and user-visible disclosure
before cloud execution is enabled.

The exact monetary limits remain a deployment decision that must be approved
before cloud execution is enabled.
Artifacts entitlement is also a hard gate. Local/private runs remain available
without these cloud controls.

## Consequences

- The existing cloud-run route is scaffolding and must not be publicly enabled.
- Platform limits and AI Gateway spending controls may provide additional
  protection, but cannot replace Docs Trials' own cross-product admission
  record.
- A system interruption yields a failed phase and inconclusive verification,
  not an unsupported documentation failure.
- No temporary storage replacement is introduced while Artifacts access is
  unresolved.
