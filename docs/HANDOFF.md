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
  redacted package, and cleans up. It is not live-tested and does not persist.
- The safety review now enforces one reused Sandbox session, source-file-only
  writes, immutable package/build controls, script-disabled install, absolute
  run deadlines, blocked external browser requests, bounded browser evidence,
  no Browser recording, terminal Think cancellation before purge, and admission
  release only after cleanup succeeds.
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

All passed on 2026-07-21. The test suite contains 22 passing tests. `pnpm build`
uses Wrangler's `--containers-rollout=none` dry-run path because Docker is not
available locally; no Worker or container was deployed.

## Cloud Access State

Wrangler is authenticated to account `be19a16e5d1b66ff19c4e9a90096344e` with
Workers, AI, Browser, Containers, and Artifacts write scopes. On 2026-07-21,
`pnpm exec wrangler artifacts namespaces list` reached the private-beta API and
returned `No Artifacts namespaces found`. Getting `docs-trials` returned
`10200 Namespace not found`; the previous entitlement error `10015` is gone.
This confirms API access, not repository or versioned-file behavior.

Installed Wrangler 4.111.0 exposes Artifacts namespace `list` and `get`, but no
namespace creation command. Repository commands include `create`, `list`,
`get`, `delete`, and `issue-token`; they require `--namespace`. The next session
must retrieve the current namespace creation API rather than inventing it.

Do not treat a successful local preview as a real Sandbox, Browser Run,
Workflow, or Artifacts validation. The local configuration intentionally omits
Artifacts. Cloud run and grader routes still return `503`, and no cloud
deployment or paid run occurred in this session.

The remaining release gates include exact monetary/rate controls, live cleanup
and cancellation races, Workflow/Think/Artifact retention deletion, Access and
admission behavior, and two repeatable frozen smoke runs.

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

1. Load the Wrangler and Cloudflare skills, retrieve current Artifacts docs and
   the namespace creation API, and do not rely on pre-trained private-beta API
   knowledge. Wrangler 4.111.0 does not expose namespace creation.
2. Create the `docs-trials` namespace and a disposable repository, then validate
   one harmless versioned file end to end: write, read, revision/history, and
   deletion. Do not deploy the Worker or run the prepared Workflow yet.
3. Record the observed namespace/repository/token/Git behavior and deletion
   semantics in `research/platform-capabilities.md`.
4. Connect the prepared evidence package to the validated Artifacts repository,
   then live-test Access, admission, Think, Sandbox, Browser Run, cancellation,
   retention, and cleanup while public cloud routes remain disabled.
5. Review ADR 0007 enforcement, exact spending/rate controls, and hard deletion,
   then run the frozen smoke trial twice before returning to RealtimeKit.
6. Keep the frontend and agent-neutral local runner parked unless required by
   the controlled cloud path.

## Worktree

All repository files remain uncommitted, by request. Do not discard or reset
existing changes.
