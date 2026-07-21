# Docs Trials

Docs Trials evaluates whether an AI coding agent can use developer documentation to complete and verify a real integration task.

It measures outcomes, not prose quality. A trial gives a controlled coding agent a task, constrained documentation resources, an isolated build environment, and deterministic acceptance criteria. The result is an evidence-backed Agent Experience report (`AX.md`) with findings and proposed documentation fixes.

## First milestone

The first vertical slice is a curated RealtimeKit trial:

> Using only the supplied RealtimeKit resources, build and verify a React video room where two browser participants can join, publish media, leave, and rejoin.

The smallest complete path is:

```txt
Curated task -> coding agent -> Sandbox preview -> Browser Run grader -> AX.md
```

## Repository guide

- [`AGENTS.md`](AGENTS.md): operating instructions and fixed product decisions.
- [`docs/PRODUCT.md`](docs/PRODUCT.md): product definition and scope.
- [`docs/MVP.md`](docs/MVP.md): first trial contract and acceptance criteria.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): target system design.
- [`docs/UX.md`](docs/UX.md): user experience and interface states.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md): implementation sequence.
- [`docs/SMOKE_TRIAL.md`](docs/SMOKE_TRIAL.md): first controlled-cloud validation task.
- [`research/`](research/README.md): evidence, assumptions, and open research questions.

## Status

The first executable vertical slice is implemented locally: validated trial
schemas, redacted evidence, deterministic local grading, an `AX.md` report,
and a Kumo dashboard. The account is Workers Paid and Artifacts API entitlement
is now confirmed. Namespace, repository, versioned-file, retention, and wider
controlled-cloud behavior remain unvalidated, so cloud routes stay disabled.
See [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
