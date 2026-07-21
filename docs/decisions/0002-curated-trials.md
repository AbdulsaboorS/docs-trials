# ADR 0002: Start With Curated Trials

## Status

Accepted

## Context

Arbitrary tasks make deterministic grading, environment preparation, and causal comparison substantially harder. The product needs a credible end-to-end demonstration before general task authoring.

## Decision

The MVP offers curated trial templates only. The first template is a RealtimeKit two-participant React video room.

## Consequences

- Acceptance criteria and browser evidence can be deterministic.
- The initial dashboard is simpler and the evidence model is concrete.
- Users cannot yet benchmark their custom product workflow.
- General task authoring will require a validated task schema, secret model, and grader contract.
