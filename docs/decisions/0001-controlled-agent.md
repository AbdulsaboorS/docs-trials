# ADR 0001: Start With A Controlled Coding Agent

## Status

Accepted

## Context

Docs Trials needs reproducible evidence about documentation usability. Running arbitrary customer agents inside local editors would make task inputs, resource access, environment state, model configuration, and telemetry difficult to control.

## Decision

The first product runs a Docs Trials controlled coding agent in an isolated environment. Customer agents may invoke Docs Trials later through an MCP server, CLI, or adapter, but are not the initial evaluation target.

## Consequences

- Trials can freeze inputs and compare resource variants fairly.
- The platform owns complete traces and can enforce secret boundaries.
- Results initially represent the controlled harness, not every external coding agent.
- External-agent adapters remain a planned extension, not an MVP dependency.
