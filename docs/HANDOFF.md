# Session Handoff

Updated: 2026-07-21

## Completed

- Phase 0 findings are recorded in `research/platform-capabilities.md`.
- The project has `pnpm` tooling, Worker configuration, Kumo/Tailwind v4 UI,
  strict TypeScript, ESLint, Prettier, Vitest, and Wrangler dry-run builds.
- The local path validates trial schemas, redacts credential-shaped evidence,
  emits all required local evidence files, produces deterministic grader
  results, and renders `AX.md`.
- Think, Sandbox, Browser Run, Workflow, and Artifacts bindings/adapters are
  present and recognized by `pnpm build`.
- `docs/RUNBOOK.md` contains the deployment and live-test procedure.
- The local workbench preview is available with `pnpm dev:local` at
  `http://localhost:8787`. It omits the remote Artifacts binding and runs the
  curated synthetic report test double locally. The UI labels this as
  illustrative rather than executed integration evidence.
- The routed workbench now includes homepage, architecture explainer, custom
  trial builder, manifest review, local-run timeline preview, and report view.
  Direct SPA routes work under the Worker asset configuration. Custom drafts
  remain browser-only and do not execute.
- The first agent-neutral local runner is available through
  `pnpm trial:local:prepare`, `pnpm trial:local:capture`, and
  `pnpm trial:local:view`. It writes manifests, agent instructions, redacted
  evidence, `AX.md`, and JSON reports under `.docs-trials/runs/` in the user's
  workspace. See [`docs/LOCAL_RUNNER.md`](LOCAL_RUNNER.md).
- `updates-filter-smoke-v1` and its incomplete built-in React starter define
  the first no-credential controlled-cloud validation task. Its deterministic
  browser rules have cloud-independent tests. See
  [`docs/SMOKE_TRIAL.md`](SMOKE_TRIAL.md).
- Grader results now use explicit `passed`, `failed`, or `inconclusive`
  outcomes. Reports separate proven failures from unavailable evidence and do
  not turn platform interruptions into documentation failures.
- ADR 0007 freezes the authentication, exact admission accounting, run budget,
  cancellation, authorization, and retention requirements that gate cloud
  execution.
- The disabled controlled-cloud implementation now prepares the frozen starter
  in an RPC Sandbox, submits bounded Think work with approved tools, installs
  and builds, opens a port-4173 tunnel, grades with Browser Run, assembles the
  redacted package, and saves it through the Artifacts binding and a separate
  clean Git Sandbox. This path is not live-tested.
- The safety review now enforces one reused trial Sandbox session,
  source-file-only writes, immutable package/build controls, script-disabled
  install, absolute run deadlines, blocked external browser requests, bounded
  browser evidence, no Browser recording, a credential-isolated persistence
  Sandbox, terminal Think cancellation before purge, and admission release only
  after cleanup succeeds.
- Cloudflare Access claim/signature validation, per-identity atomic admission,
  one active run, idempotent retries, cancellation, fixed resource ceilings,
  and a seven-day Artifact retention target are prepared behind the disabled
  route. Browser recording is disabled and Think state is purged on cleanup;
  Artifact hard deletion still requires live validation.
- The workbench replays canonical synthetic events through all six phases and
  presents passed, failed, cancelled, and inconclusive terminal states without
  invoking paid services.

## Verified Commands

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm trial:local
pnpm --dir fixtures/updates-filter-starter build
```

All passed on 2026-07-21. The test suite contains 27 passing tests. `pnpm build`
uses Wrangler's `--containers-rollout=none` dry-run path because Docker is not
available locally; no Worker or container was deployed.

## Cloud Access State

Wrangler is authenticated to account `be19a16e5d1b66ff19c4e9a90096344e` with
Workers, AI, Browser, Containers, and Artifacts write scopes. On 2026-07-21, a
disposable repository implicitly created the `docs-trials` namespace. Separate
short-lived write and read tokens successfully pushed and retrieved two Git
revisions, including prior-revision content. Repository deletion immediately
produced `10200 Repository not found`, an empty repository list, and namespace
`repo_count: 0`.

Installed Wrangler 4.111.0 exposes Artifacts namespace `list` and `get`, but no
namespace creation command. Current docs confirm namespaces are created
implicitly by the first repository. Repository metadata left `last_push_at`
null after successful pushes, so Git retrieval is the persistence check.

Do not treat a successful local preview as a real Sandbox, Browser Run,
Workflow, or Artifacts validation. The local configuration intentionally omits
Artifacts. Cloud run and grader routes still return `503`, and no cloud
deployment or paid run occurred in this session.

The remaining release gates include a live test of the prepared persistence
adapter, exact monetary/rate controls, live cleanup and cancellation races,
Workflow/Think/Artifact retention deletion, physical purge confirmation,
authenticated evidence reads, Access and admission behavior, and two repeatable
frozen smoke runs.

## Current Product Direction

- A user supplies documentation and defines the task to test. Workers AI may
  suggest a task, but a user approves the frozen manifest.
- The first self-serve verification profile is web applications with
  browser-visible acceptance criteria.
- The product supports two execution modes: controlled cloud runs for
  reproducibility and an agent-neutral local runner for a user's existing
  coding agent.
- Anonymous users run locally; reports render in a local viewer and download
  as `AX.md`, JSON, and redacted evidence. No anonymous cloud persistence.
- Deterministic verification owns pass/fail. AI diagnostics provide
  evidence-linked documentation recommendations with confidence and cannot
  alter that outcome.
- The local runner currently captures an explicit verification command and
  source diff. Browser-only criteria remain `inconclusive` until a local
  browser verifier is implemented; do not interpret that state as a docs
  failure.
- The no-credential updates-filter task is an internal platform smoke test, not
  a documentation-quality assessment.

## Resume Steps

1. Review and deploy the disabled-route Worker only after approving expected
   paid Sandbox/container usage. Do not enable public run or grader routes.
2. Live-test one package save through the binding, clean persistence Sandbox,
   Git revision verification, stale-token cleanup, and cancellation cleanup.
3. Implement and test the seven-day retention scheduler/index plus authenticated
   evidence reads. Confirm physical purge semantics rather than inferring them
   from immediate `10200` responses.
4. Review ADR 0007 enforcement and approve exact spending/rate controls, then
   live-test Access, admission, Think, Sandbox, Browser Run, cancellation, and
   cleanup while public cloud routes remain disabled.
5. Run the frozen smoke trial twice before returning to RealtimeKit.
6. Keep the frontend and agent-neutral local runner parked unless required by
   the controlled cloud path.

## Worktree

The baseline is committed and pushed to
`https://github.com/AbdulsaboorS/docs-trials` at `af09d9e`. The current branch
adds the prepared Artifacts persistence path on top of that baseline. Do not
discard or reset existing changes.
