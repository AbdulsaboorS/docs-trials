# Session Context

Updated: 2026-08-20

Replace this handoff after substantial work. Never exceed 50 lines.

## Last Session Summary

- The product contract and design tree are confirmed in `docs/PRODUCT.md`.
- `CONTEXT.md` defines Trial, Attempt, Check, Finding, and Recommendation.
- Two ADRs preserve local execution and deterministic outcome ownership.
- v0 is a local macOS/Linux CLI for browser-based web integrations.
- v0 ships with an operator skill, Astro landing page, and one sample report.
- It has no telemetry, publishing, hosted execution, or model recommendations.
- Product learning uses reviewed releases, never automatic self-modification.
- Oxlint will run beside ESLint before blocker implementation starts.
- The current CLI still has 12 known blockers. Five permit false passes.
- Gate 2 and public release remain blocked until those defects are fixed.
- Current changes are documentation, project guidance, and untracked CI only.

## Next Session Work

1. Read the required files below and inspect the worktree.
2. Review and commit the guidance, product contract, ADRs, and CI workflow.
3. Load `install-anti-slop`; vendor Oxlint and migrate all owned source.
4. Run both linters, typecheck, tests, and build.
5. Add run-record regression tests for digest validation and `latest` selection.
6. Fix those two defects without claiming same-user tamper prevention.
7. Continue through the blocker order in `docs/PRODUCT.md` and private reports.

Do not start Gate 2 while any known false-pass path remains.

## Required Files

- `AGENTS.md`, `CONTEXT.md`, and `docs/PRODUCT.md`
- `docs/adr/*.md` and `README.md`
- `src/core/run.ts`, `src/core/manifest.ts`, and `src/core/outcome.ts`
- `src/checks/index.ts`, `src/checks/page.ts`, and `src/core/redact.ts`
- `tests/baseline.test.ts` and `~/.docs-trials/reviews/*.md`

## Blockers

- Twelve review defects remain unfixed; current green tests miss them.
- npm `docs-trials` is not published or reserved.
- Port 5173 has an unrelated Vite listener; avoid it in real trials.
