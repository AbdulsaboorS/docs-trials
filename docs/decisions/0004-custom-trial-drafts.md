# ADR 0004: Accept Custom Trial Drafts Before Custom Execution

## Status

Accepted

## Current Note

ADR 0005 subsequently added executable custom local manifests through the
agent-neutral runner. Custom drafts still do not execute in the controlled
cloud path, and browser-only local criteria remain inconclusive until the local
Playwright verifier is implemented.

## Context

Docs Trials should let visitors evaluate documentation beyond the curated
RealtimeKit baseline. Visitors need to supply public documentation URLs or
pasted Markdown, an integration task, and either a supported starter template
or a repository URL.

Running arbitrary visitor input immediately would turn the Worker into an
unauthenticated paid compute endpoint. It would also bypass the task schema,
network policy, secret boundary, deterministic grader contract, and evidence
retention requirements that make a result credible.

## Decision

The MVP workbench accepts custom trial drafts in the browser. Drafts may use
Markdown, public documentation URLs, a Docs Trials starter template, or a
repository URL. The UI validates the minimum inputs but does not persist or
execute custom drafts yet.

The curated RealtimeKit baseline remains the only planned executable
controlled-cloud trial while that workflow is completed. Custom cloud execution
requires authentication, a per-run budget, a validated schema, a sandbox
network policy, and deterministic acceptance checks. ADR 0005 separately
permits custom local execution.

## Consequences

- Visitors can see the intended self-serve authoring model immediately.
- The product does not imply that arbitrary drafts have been evaluated.
- Custom documents and repository URLs are not retained by the MVP UI.
- ADR 0002 remains true for controlled-cloud trials and will be superseded when
  custom cloud execution is implemented.
