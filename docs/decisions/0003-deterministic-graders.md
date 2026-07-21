# ADR 0003: Deterministic Graders Decide Outcomes

## Status

Accepted

## Context

An LLM can provide helpful diagnosis but is not a reliable sole authority for whether a generated application works or handles secrets correctly.

## Decision

Pass/fail is determined by executable grader criteria. An analysis agent may synthesize evidence into findings and remediation suggestions, but cannot override a deterministic result.

## Consequences

- Trial tasks must include explicit, testable requirements.
- Browser and runtime evidence is first-class product data.
- Some qualitative properties remain out of scope until a robust evaluator is defined.
