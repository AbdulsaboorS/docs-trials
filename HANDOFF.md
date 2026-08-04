# Session Handoff

Transient working note. Delete it when Gate 2 finishes. It is not product
documentation. `AGENTS.md` holds the durable rules.

Updated: 2026-08-04

## Where the project is

`main` is at `6da5efa` and matches `origin/main`. The previous Cloudflare
Workers implementation is at tag `archive/cloud-path-v0`. Do not restore it
piecemeal.

**Gate 2 is blocked.** Two independent reviews found five ways to get a green
report from a broken application. Read the next section before you write code.

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

## Review findings, 2026-08-04

Two reviewers worked in parallel against commit `6da5efa`. One attacked the
honesty guarantee. One reviewed correctness and readiness. Both reproduced their
findings by running the code.

Full reports, kept out of the public repository on purpose:

```txt
~/.docs-trials/reviews/ADVERSARY-REPORT.md
~/.docs-trials/reviews/ENGINEER-REPORT.md
```

Fix these before Gate 2. The order is by severity.

| # | Defect | File |
| --- | --- | --- |
| 1 | `verify` never recomputes `manifestDigest`. The agent under test can rewrite the frozen commands and forge a full pass. | `src/core/run.ts:69` |
| 2 | A same-origin asset that returns 404 passes all eight checks. `isResourceComplaint()` moves the console error where nothing grades it. | `src/checks/page.ts:59` |
| 3 | `latestRunId()` sorts directory names. The manifest ID precedes the timestamp, so `verify latest` picks the wrong run. | `src/core/run.ts:92` |
| 4 | The secret scan reads only `document` and `script` responses. CSS, JSON, and fetch responses escape. Truncation at four million characters is silent. | `src/checks/page.ts:73` |
| 5 | A blank page passes. No check requires the entry page to render visible content. | `src/checks/index.ts` |
| 6 | Redaction masks the scheme, not the credential. It also deletes non-secret source expressions named `authorization`. | `src/core/redact.ts:29` |
| 7 | A command timeout and shell exit 127 are recorded as `failed`. Both are infrastructure trouble and must be `inconclusive`. | `src/checks/command.ts:53` |
| 8 | A busy port that is not HTTP is recorded as `failed`. | `src/checks/preview.ts:32` |
| 9 | Inline `text` documents never reach the agent. Any trial using them is invalid before it starts. | `src/commands/prepare.ts:49` |
| 10 | Errors raised after `networkidle` escape observation. A fault 2.5 seconds after load passes. | `src/checks/page.ts:111` |
| 11 | `AX.md` leads with `PASSED` and puts the task-scope limit last. A skimming reader misreads it. | `src/core/report.ts` |
| 12 | A second interrupt can leave a package manager or server alive. | `src/util/process.ts:61` |

Defect 2 was introduced on 2026-08-04. `isResourceComplaint()` was added that
day to keep Chromium's CORS noise out of application errors. It also hid real
asset failures. Add a regression test with the fix.

## Open items

1. **CI is not pushed.** `.github/workflows/ci.yml` exists locally and is
   untracked. The `gh` token has `repo` but not `workflow` scope. The user must
   run `gh auth refresh -s workflow`, then commit and push it.
2. **Gate 2 is blocked** by the twelve defects above. Ten trials against named
   third-party documentation, unsteered, then a findings table. The user
   approved publishing named results.
3. **Validity limit to keep stating.** The same agent wrote the checks and acted
   as the subject in Gate 1. That proves the pipeline is honest. It does not
   prove a finding is valid.
4. **Gate 1 tested one direction only.** It confirmed a true failure. It did not
   probe for false passes. Variant B failed only because React threw an error. A
   silently blank page would have passed.

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
