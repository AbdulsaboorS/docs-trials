# Session Handoff

Transient working note. Delete it when Gate 2 finishes. It is not product
documentation. `AGENTS.md` holds the durable rules.

Updated: 2026-08-04

## Where the project is

`main` is at `390371a` and matches `origin/main`. The previous Cloudflare
Workers implementation is at tag `archive/cloud-path-v0`. Do not restore it
piecemeal.

The repository is now a local CLI. 1,910 lines of source, 405 of tests, 41
tests passing. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are
all green.

```txt
src/cli.ts              argument parsing, exit codes, error surface
src/commands/           init, prepare, verify
src/core/outcome.ts     CheckId enum, CheckResult, deriveOutcome
src/core/manifest.ts    Zod manifest schema, digest
src/core/run.ts         run store under ~/.docs-trials/runs/<id>
src/core/report.ts      AX.md renderer
src/core/redact.ts      value masking
src/checks/index.ts     baseline orchestrator
src/checks/command.ts   bounded shell execution
src/checks/preview.ts   start the app, wait for an HTTP answer
src/checks/page.ts      Playwright observation
src/checks/secrets.ts   credential detection in delivered assets
src/util/               process tree cleanup, Git baseline and diff
fixtures/sample-app/    one fixture whose defects are selected by env var
```

## What changed and why

The old runner assigned a shell command's exit code to whichever author
criterion came first. `echo hello` produced `PASSED — A customer can complete a
Stripe Checkout payment`. Reproduced, then removed by design: results are keyed
by `CheckId` in `src/core/outcome.ts`, every check is code in this package, and
author `goals` are recorded but never graded. `tests/outcome.test.ts` asserts an
invented criterion cannot receive an outcome.

Also corrected: runs moved outside the workspace, redaction masks values instead
of rewriting matches, startup and navigation problems are inconclusive rather
than failed, browser resource complaints are separated from application errors,
cleanup never discards a completed run, and verify is re-runnable.

Deleted: Worker, workbench UI, Workflow, Artifacts, Sandbox, Browser Run,
admission controls, AI Search preflight, 8 ADRs, 5 research notes.

## Gate 1 result

Two variants of one real trial. Real workspace, real TanStack Query
documentation, an agent working from that page only.

- Variant A, built correctly: `PASSED`, 8 of 8. Body text evidence confirms the
  todo titles rendered.
- Variant B, following the quick start's final line literally
  (`render(<App />, ...)`, the React 17 API): `FAILED`. Install, build, boot,
  and page load all pass with HTTP 200. The page is blank. Only the browser
  check observes `render is not a function`.

## Open items

1. **CI is not pushed.** `.github/workflows/ci.yml` exists locally and is
   untracked. The `gh` token has `repo` but not `workflow` scope. The user must
   run `gh auth refresh -s workflow`, then commit and push it.
2. **Gate 2 has not started.** Ten trials against named third-party
   documentation, unsteered, then a findings table. The user approved publishing
   named results.
3. **Validity limit to keep stating.** The same agent wrote the checks and acted
   as the subject in Gate 1. That proves the pipeline is honest. It does not
   prove a finding is valid.

## Architecture direction

Execution stays local. Cloudflare services join on the sharing surface only.

| Stage | Scope |
| --- | --- |
| v0, now | CLI, baseline checks, no network dependency |
| v1 | `docs-trials publish` — Worker, R2, D1, Turnstile |
| v2 | Task checks proposed from docs, approved, frozen, run locally |
| v3 | Hosted runs, only on user demand |

## Working agreement

Three gates. Gate 1 is done. Gate 2 is the ten trials and it is the only gate
that can end the project. Gate 3 is anything public: npm publish, README
claims, a post. Between gates, work continues without checkpoints.
