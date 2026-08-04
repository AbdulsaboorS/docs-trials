# Trial Runbook

## Local Validation

```sh
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm trial:local
```

`pnpm build` uses `--containers-rollout=none` for its Wrangler dry run so local
validation does not require Docker. A real deployment must build and roll out
the pinned Sandbox container in `Dockerfile`; do not use that flag for the live
Sandbox validation.

`pnpm trial:local` writes a canonical synthetic evidence package to
`trial-output/<run-id>/`. It tests the evidence and report contract without a
real coding agent, Cloudflare service, or RealtimeKit call.

## Agent-Neutral Local Runner

To capture a real external-agent run in the user's workspace:

Begin from a clean committed Git baseline so capture can preserve every source
change relative to preparation.

```sh
pnpm trial:local:prepare -- --manifest trial.manifest.json --workspace .
pnpm trial:local:capture -- --run .docs-trials/runs/<run-id> --control-digest <controlSha256> --workspace .
pnpm trial:local:view -- .docs-trials/runs/<run-id>
```

Give the generated `AGENT_INSTRUCTIONS.md` to the user's coding agent between
`prepare` and `capture`, while retaining the printed control digest outside the
agent conversation. This path records the verification command and source diff.
The checked-in updates-filter profile also performs local Playwright checks;
other browser-only criteria remain `inconclusive`. See
[`LOCAL_RUNNER.md`](LOCAL_RUNNER.md).

## Local Workbench Preview

Run the workbench with local Durable Objects and Workflow bindings:

```sh
pnpm dev:local
```

Open [http://localhost:8787](http://localhost:8787). This configuration omits
the remote Artifacts binding, so it does not require a provisioned namespace.
The curated trial's **Run local evidence** action remains fully local and does
not invoke Think, Sandbox, Browser Run, or RealtimeKit. Its output is explicitly
labeled as a synthetic report preview, not a completed documentation trial.

After installing local Chromium, verify direct-run refresh recovery and the
browser-only custom-draft boundary while `dev:local` is running:

```sh
pnpm smoke:workbench:recovery
```

## Current Release Path

Before private cloud validation:

1. Complete a manual acceptance pass through the local workbench.
2. Connect the workbench to the agent-neutral local runner.
3. Add CI and package an installable local CLI.

These are the local-beta release steps. The cloud controls below do not block
anonymous local runs.

## AI Search Connected-Trial Preflight

Prepare the credential-free private run package and render its expected
inconclusive preflight report:

```sh
pnpm trial:ai-search:prepare -- ais-contract-001
pnpm trial:ai-search:preflight -- trial-output/ais-contract-001
```

Preparation retrieves and hashes the three assigned documentation pages, then
creates an incomplete Worker workspace, three synthetic Markdown documents, a
content-addressed starter, a SHA-256-bound frozen contract, and agent
instructions. It creates no Cloudflare resource. Reusing a run ID fails instead
of overwriting evidence.

The checked-in preflight command generates canonical unavailable observations
internally and writes one non-overwriting local report set under `preflight/`.
It cannot accept available or passing observations, and a second invocation
refuses to overwrite the report. Local files are not an authenticity boundary;
a future trusted adapter must anchor the admitted contract digest and output
manifest in versioned storage. Do not run the generated workspace's live
commands with account credentials available; its `dev` script intentionally
fails until that adapter exists.

## Deferred Private-Cloud Deployment

The deployment uses one Cloudflare Worker with AI, Browser Run, Worker Loader,
Sandbox, Workflow, and Artifacts bindings. It requires a Workers Paid account
because Sandbox uses Dynamic Workers and Artifacts is beta-gated. The current
account is Workers Paid and Artifacts entitlement is confirmed, but no Worker
has been deployed.

1. Approve exact monetary and rate limits and review every ADR 0007 gate.
2. Authenticate Wrangler with an account that has Workers, AI, Browser, and
   Artifacts write permissions.
3. Deploy only with public cloud execution routes still disabled:

```sh
pnpm build
pnpm exec wrangler deploy
```

The no-credential smoke trial obtains its preview URL directly from its own
Sandbox quick tunnel. It has no public grader endpoint, and Browser Run blocks
runtime requests to every other origin.

## Private Live Checks

Public cloud execution is disabled in the Worker. Artifacts API entitlement and
standalone Git behavior are confirmed, but public run and grader routes must
continue returning `503` while an Access-protected internal route privately
validates the application persistence adapter and ADR 0007's authentication,
admission, budget, cancellation, authenticated read, and retention controls
under the approved budget.

After a safe deployment, open the Worker URL to load the Kumo dashboard and
check the account configuration:

```sh
curl https://<worker-url>/health
```

Confirm that the phase workflow cannot be scheduled publicly:

```sh
curl -X POST https://<worker-url>/api/trials/realtimekit-video-room-v1/run
```

Confirm that direct Browser Run grading is also disabled:

```sh
curl -X POST https://<worker-url>/api/grade/realtimekit \
  -H "content-type: application/json" \
  --data '{"previewUrl":"https://preview.example.workers.dev"}'
```

Both requests must return `503`. Add an Access-protected internal validation
route only after the controls, persistence adapter, cleanup, and retention
behavior are ready for private live validation. Public routes remain disabled.

The prepared Access validator requires `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
It accepts any identity authorized by the Access application; there is no
application-level email allowlist. These settings do not enable public routes.

## RealtimeKit Validation

Only after two repeatable `updates-filter-smoke-v1` runs pass the private checks,
set the RealtimeKit trial's non-persistent auth values:

```sh
pnpm exec wrangler secret put REALTIMEKIT_AUTH_ENDPOINT
pnpm exec wrangler secret put REALTIMEKIT_ROOM_NAME
```
