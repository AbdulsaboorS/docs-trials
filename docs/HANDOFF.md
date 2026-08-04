# Session Handoff

Updated: 2026-07-22

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
- The local runner now supports deterministic Playwright verification for the
  frozen updates-filter profile. It requires a clean Git baseline and an
  out-of-band control digest, preserves bounded source/browser observations,
  blocks external browser HTTP and WebSocket requests, and cleans up the local
  browser and preview process tree. Arbitrary custom browser criteria remain
  inconclusive.
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

All passed on 2026-07-22. The test suite contains 44 passing tests. `pnpm build`
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

The remaining cloud-enablement gates include a live test of the prepared
persistence adapter, exact monetary/rate controls, live cleanup and cancellation
races, Workflow/Think/Artifact retention deletion, physical purge confirmation,
authenticated evidence reads, Access and admission behavior, and two repeatable
frozen smoke runs. They do not block the local-first beta.

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
- Deterministic verification owns the `passed`, `failed`, or `inconclusive`
  outcome. AI diagnostics provide evidence-linked documentation recommendations
  with confidence and cannot alter it.
- The local runner currently captures an explicit verification command and
  source diff. Browser-only criteria remain `inconclusive` until a local
  browser verifier is implemented; do not interpret that state as a docs
  failure.
- The no-credential updates-filter task is an internal platform smoke test, not
  a documentation-quality assessment.

## Resume Steps

1. Have the user complete a short manual acceptance pass through the local
   workbench. The health endpoint was verified, but this UX pass is still
   pending.
2. Connect the workbench to the agent-neutral local runner, add CI for the
   established validation commands, and package an installable CLI.
3. Correct issues found by local acceptance and prepare the `v0.1.0` local beta
   before spending on private cloud validation.
4. Only after exact budget approval and ADR 0007 gate review, deploy with public
   cloud routes disabled and live-test persistence, retention, Access,
   admission, cancellation, and cleanup.
5. Run `updates-filter-smoke-v1` twice before returning to RealtimeKit.

## Next Connected Trial

The first user-selected dogfood target is Cloudflare AI Search: create a
built-in-storage knowledge base from three synthetic internal documents and
expose its built-in MCP search tool. The website must not request access to a
user's Cloudflare account. ADR 0008 makes Docs Trials-owned ephemeral resources
the hosted default and keeps local BYO-account execution as an advanced mode.

The first run is maintainer-only. Preserve the full MCP task even though current
assigned docs describe public MCP enablement as a dashboard action; an observed
failure there is a valid finding. Do not create a live resource until the
checked-in resource envelope, deterministic grader, exact budget, private route,
and cleanup verification are reviewed.

## Worktree

Before this documentation handoff, local and GitHub `main` were synchronized at
`debccd2` (`Persist cloud trial evidence in Artifacts`). The handoff and stale
documentation cleanup are uncommitted working-tree changes and contain no
application-source edits. Do not discard unrelated concurrent changes.
