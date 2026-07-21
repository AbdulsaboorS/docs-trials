# ADR 0005: Support Private Agent-Neutral Local Runs

## Status

Accepted

## Context

The controlled cloud agent is necessary for reproducible comparisons, but it
does not mirror how most developers use documentation. Developers usually give
documentation to an existing coding agent inside their own repository. Running
every trial in the cloud also requires account identity, abuse controls, and a
budget.

The product needs an anonymous path that lets users assess their documentation
without uploading pasted documentation, generated source, or reports.

## Decision

Docs Trials will define a shared frozen trial manifest and support two clearly
labeled execution modes:

- **Controlled cloud run:** Docs Trials operates the agent and runtime. It is
  the comparable, cloud-persisted mode and requires authenticated budgeted
  execution.
- **Agent-neutral local run:** a Docs Trials CLI prepares the manifest and
  agent-ready instructions, then collects redacted evidence and runs a local
  verifier around the user's chosen coding agent and workspace.

Anonymous users may create trial drafts and execute agent-neutral local runs.
The local runner opens a local report viewer and writes downloadable `AX.md`,
report JSON, and redacted evidence. It does not upload those artifacts.

## Consequences

- Local results must disclose agent/model metadata and have lower comparability
  than controlled cloud runs.
- The evidence collector and deterministic verifier are owned by Docs Trials,
  not the coding agent being evaluated.
- A report can distinguish documented failure, environment failure, agent
  failure, and inconclusive evidence without asserting that the docs are at
  fault.
- A separately executable CLI is justified after the frontend review and will
  use the same manifest/report schemas as the Worker.
