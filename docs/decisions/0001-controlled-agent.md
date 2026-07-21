# ADR 0001: Start With A Controlled Coding Agent

## Status

Accepted

## Current Note

ADR 0005 added an agent-neutral local mode and the current release sequence
ships that local path before controlled cloud execution. The controlled agent
remains the required mode for comparable cloud trials; only the release order
changed.

## Context

Docs Trials needs reproducible evidence about documentation usability. Running arbitrary customer agents inside local editors would make task inputs, resource access, environment state, model configuration, and telemetry difficult to control.

## Decision

The comparable cloud product runs a Docs Trials controlled coding agent in an
isolated environment. The agent-neutral local mode added by ADR 0005 serves
existing customer agents without changing the controlled harness used for
comparisons.

## Consequences

- Trials can freeze inputs and compare resource variants fairly.
- The platform owns complete traces and can enforce secret boundaries.
- Results initially represent the controlled harness, not every external coding agent.
- External agents use the local runner and remain outside controlled-cloud
  comparisons.
