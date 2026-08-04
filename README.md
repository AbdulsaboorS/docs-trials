# Docs Trials

Docs Trials evaluates whether an AI coding agent can use developer documentation to complete and verify a real integration task.

It measures outcomes, not prose quality. A trial freezes a task, documentation
resources, environment, and deterministic acceptance criteria. It can run with
a Docs Trials-controlled cloud agent or through the agent-neutral local runner.
The result is an evidence-backed Agent Experience report (`AX.md`) with findings
and proposed documentation fixes.

## Controlled-Cloud Showcase

The first controlled-cloud showcase is a curated RealtimeKit trial:

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
- [`docs/AI_SEARCH_TRIAL.md`](docs/AI_SEARCH_TRIAL.md): first private connected-integration dogfood contract.
- [`research/`](research/README.md): evidence, assumptions, and open research questions.

## Status

The local vertical slice includes validated trial schemas, redacted evidence,
deterministic command grading, portable `AX.md` reports, an agent-neutral local
runner, a checked-in local Playwright profile for the updates-filter smoke task,
and a Kumo workbench. Unsupported user-authored browser criteria remain
inconclusive rather than being inferred from agent claims.

Artifacts entitlement and its standalone Git path are confirmed, including
implicit namespace creation, scoped tokens, two-revision history, historical
reads, and control-plane repository deletion. The application persistence
adapter, physical purge behavior, and complete cloud pipeline have not been
deployed or live-tested. Cloud execution routes remain disabled.

The current release path is local-first: manual workbench acceptance,
UI/runner integration, CI, and installable CLI packaging. See
[`docs/RUNBOOK.md`](docs/RUNBOOK.md).

The AI Search connected-trial preflight now freezes a credential-free synthetic
knowledge corpus, isolated resource envelope, deterministic MCP checks, and
cleanup-gated outcome. It does not create live Cloudflare resources; a trusted
provider adapter and private safety review remain required.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
