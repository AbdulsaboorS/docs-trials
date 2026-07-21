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

`pnpm trial:local` writes a complete deterministic evidence package to
`trial-output/<run-id>/`. It does not contact Cloudflare or RealtimeKit.

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

## Deploy Prerequisites

The deployment uses one Cloudflare Worker with AI, Browser Run, Worker Loader,
Sandbox, Workflow, and Artifacts bindings. It requires a Workers Paid account
because Sandbox uses Dynamic Workers and Artifacts is beta-gated.

1. Upgrade the deployment account to Workers Paid.
2. Authenticate Wrangler with an account that has Workers, AI, Browser, and
   Artifacts write permissions.
3. Before returning to the connected RealtimeKit trial, set its non-persistent
   auth values:

```sh
pnpm exec wrangler secret put REALTIMEKIT_AUTH_ENDPOINT
pnpm exec wrangler secret put REALTIMEKIT_ROOM_NAME
```

The no-credential smoke trial obtains its preview URL directly from its own
Sandbox quick tunnel. It has no public grader endpoint, and Browser Run blocks
runtime requests to every other origin.

4. Deploy:

```sh
pnpm build
pnpm exec wrangler deploy
```

## Live Checks

Controlled cloud execution is currently disabled in the Worker. Artifacts API
entitlement and standalone Git behavior are confirmed, but the run and grader
routes must continue returning `503` until the prepared binding persistence path
and ADR 0007's authentication, admission, budget, cancellation, authenticated
read, and retention controls are live-validated.

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

Both requests must return `503`. Replace these checks with authenticated live
procedures only after ADR 0007 is implemented and reviewed.

The prepared Access validator requires `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
It accepts any identity authorized by the Access application; there is no
application-level email allowlist. These settings do not enable cloud routes.
