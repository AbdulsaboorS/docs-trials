# ADR 0007: Gate Cloud Runs Behind Admission And Lifecycle Controls

## Status

Accepted

## Current Note

Artifacts entitlement and standalone Git behavior were confirmed on
2026-07-21. The application persistence adapter, retention and physical purge,
authenticated reads, exact monetary limits, and the remaining lifecycle
controls still require private live validation before public cloud execution
can be enabled. That validation may use only a budget-approved,
Access-protected internal route.

## Context

A controlled cloud run can consume model, Sandbox, Browser Run, Workflow, and
Artifacts resources. An unauthenticated or unbounded run endpoint would expose
paid compute, retain sensitive evidence without a clear policy, and make abuse
or accidental spending difficult to contain.

## Decision

Public cloud execution remains disabled until all of these controls are
enforced and live-validated. Once they are implemented and exact limits are
approved, maintainers may use an Access-protected internal route for private
live validation:

- authenticated user identity on every create, inspect, cancel, and evidence
  request;
- an atomic admission record that enforces per-user run and spending limits;
- one active run per user for the first release;
- an immutable per-run budget covering model steps, retries, Workflow duration,
  Sandbox lifetime, Browser Run duration, and evidence size;
- idempotent run creation so retries cannot start duplicate paid work;
- cancellation that stops future Workflow phases, terminates browser sessions
  and Sandbox processes, and records a terminal event;
- a configured, user-visible retention period plus an implemented hard-delete
  path
  for source, logs, browser evidence, reports, and associated credentials;
- redaction before durable persistence and authorization checks before every
  evidence read;
- rate limiting and abuse checks as defense in depth, not as substitutes for
  exact quota accounting.

The first private runs must test idempotency, cancellation, authorization,
retention, credential cleanup, and hard deletion. Public execution remains
disabled until those tests pass.

Internal prototype evidence uses a seven-day retention target. Any change to
that duration must update the frozen run policy and user-visible disclosure
before public cloud execution is enabled.

The exact monetary limits remain a deployment decision that must be approved
before public cloud execution is enabled.
Artifacts entitlement is also a hard gate and is now satisfied. Local runs
remain available without these cloud controls.

## Consequences

- The existing cloud-run route is scaffolding and must not be publicly enabled.
- Platform limits and AI Gateway spending controls may provide additional
  protection, but cannot replace Docs Trials' own cross-product admission
  record.
- A system interruption yields a failed phase and inconclusive verification,
  not an unsupported documentation failure.
- No temporary storage replacement is needed now that Artifacts access is
  confirmed; the real adapter and deletion lifecycle must still pass private
  live validation.
