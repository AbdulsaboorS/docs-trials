# ADR 0003: Deterministic Graders Decide Outcomes

## Status

Accepted

## Current Note

ADR 0006 replaced the binary terminology with `passed`, `failed`, and
`inconclusive`. Deterministic graders still own the outcome and an analysis
agent still cannot override it.

## Context

An LLM can provide helpful diagnosis but is not a reliable sole authority for whether a generated application works or handles secrets correctly.

## Decision

The authoritative outcome is determined by executable grader criteria. An
analysis agent may synthesize evidence into findings and remediation
suggestions, but cannot override a deterministic result. ADR 0006 defines the
three possible outcomes.

## Consequences

- Trial tasks must include explicit, testable requirements.
- Browser and runtime evidence is first-class product data.
- Some qualitative properties remain out of scope until a robust evaluator is defined.
