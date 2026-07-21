# ADR 0006: Represent Inconclusive Verification Explicitly

## Status

Accepted

## Context

A failed deterministic check and a check that could not run are different
facts. Treating both as a boolean failure would let an unavailable browser,
missing evidence, or incomplete verifier become an unsupported claim that the
application or its documentation failed.

## Decision

Every grader result has one of three outcomes:

- `passed`: the deterministic verifier observed the required behavior;
- `failed`: the deterministic verifier ran and observed behavior that
  contradicted the requirement;
- `inconclusive`: there is not enough deterministic evidence to decide.

A trial passes only when every frozen criterion has exactly one passing result.
Any explicit failed result makes the trial fail. Otherwise an incomplete or
inconclusive result makes the trial inconclusive. AI diagnosis cannot change
any of these outcomes.

## Consequences

- Reports separate deterministic failures from unresolved verification.
- Missing results, duplicate results, and platform interruptions cannot produce
  a pass.
- Inconclusive is an evidence state, not a documentation-quality judgment.
- Existing local runner output can preserve a real failed verification command
  without treating unimplemented browser checks as failures.
