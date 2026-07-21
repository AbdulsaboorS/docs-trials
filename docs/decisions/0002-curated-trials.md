# ADR 0002: Start With Curated Trials

## Status

Accepted

## Current Note

This decision remains the controlled-cloud baseline. ADRs 0004 and 0005 later
added browser-only custom drafts and executable user-authored local manifests;
they do not enable arbitrary controlled-cloud execution.

## Context

Arbitrary tasks make deterministic grading, environment preparation, and causal comparison substantially harder. The product needs a credible end-to-end demonstration before general task authoring.

## Decision

The controlled-cloud MVP offers curated trial templates only. The first
template is a RealtimeKit two-participant React video room. User-authored local
manifests are governed by ADR 0005.

## Consequences

- Acceptance criteria and browser evidence can be deterministic.
- The initial dashboard is simpler and the evidence model is concrete.
- Users cannot yet benchmark a custom workflow in the comparable controlled
  cloud mode.
- General controlled-cloud task authoring requires a validated task schema,
  secret model, and grader contract.
