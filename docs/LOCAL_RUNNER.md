# Local Agent Runner

The local runner keeps a trial's documentation, generated source, and report in
your workspace. It does not upload them.

## Create a Manifest

Create `trial.manifest.json`:

```json
{
  "version": 1,
  "id": "oauth-quickstart",
  "title": "OAuth quickstart reliability",
  "task": "Using these docs, build a React app that signs in with OAuth.",
  "documents": [
    { "label": "OAuth quickstart", "kind": "url", "value": "https://example.com/docs/oauth" }
  ],
  "starter": { "type": "workspace", "value": "." },
  "verification": {
    "profile": "web-app",
    "criteria": [
      "Application installs and builds",
      "Preview starts and can be opened in a browser"
    ],
    "command": "pnpm build"
  },
  "agent": { "name": "your coding agent", "model": "optional-model-name" }
}
```

## Prepare, Build, Capture

Start from a clean committed Git workspace. Preparation freezes the baseline
revision; capture includes staged, unstaged, committed, and untracked source
changes relative to that revision.

```sh
pnpm trial:local:prepare -- --manifest trial.manifest.json --workspace .
```

Give the generated `AGENT_INSTRUCTIONS.md` to any coding agent. Keep the
`controlSha256` printed by preparation outside the agent conversation. After it
has worked in the workspace, capture the evidence:

```sh
pnpm trial:local:capture -- --run .docs-trials/runs/<run-id> --control-digest <controlSha256> --workspace .
pnpm trial:local:view -- .docs-trials/runs/<run-id>
```

The runner validates the user-supplied verification command. User-authored
browser criteria remain inconclusive unless the manifest selects a checked-in
deterministic grader.

The local runner executes the frozen build and preview commands directly on the
user's host. Browser routing blocks browser-originated external requests, but it
does not sandbox build scripts, the preview server, or the coding agent. Use a
disposable workspace with provider credentials removed; use the controlled
cloud runner when host isolation is required.
Local command capture currently fails closed on Windows because descendant
process cleanup cannot yet be guaranteed there.

## Updates Filter Browser Profile

The first checked-in browser profile is the internal
`updates-filter-smoke-v1` platform smoke test. Install its local Chromium runtime
once:

```sh
pnpm exec playwright install chromium
```

Its manifest must use the exact acceptance criteria from
`updatesFilterSmokeTrial` and add this frozen browser configuration:

```json
{
  "verification": {
    "profile": "web-app",
    "criteria": [
      "The generated project installs and builds successfully.",
      "The generated application starts and exposes a reachable preview URL.",
      "The Updates page initially shows all three supplied updates.",
      "Selecting the Platform topic shows only the Platform update.",
      "Selecting the Archived topic shows the No updates found message.",
      "The page makes no unexpected external runtime data request.",
      "The browser console and network checks contain no unhandled application error."
    ],
    "command": "pnpm install --frozen-lockfile --ignore-scripts && pnpm build",
    "browser": {
      "grader": "updates-filter-smoke-v1",
      "startCommand": "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
      "previewUrl": "http://127.0.0.1:4173",
      "startupTimeoutSeconds": 15,
      "browserTimeoutSeconds": 30
    }
  }
}
```

The runner refuses non-loopback preview URLs, blocks external browser requests,
bounds and redacts preview/browser messages, preserves structured observations,
and closes the browser and preview process. Local screenshots are deliberately
omitted because arbitrary generated pages may display secrets. A browser
installation or launch problem is `inconclusive`; an observed application
mismatch is `failed`.

Maintainers can verify the complete local browser transport independently:

```sh
pnpm trial:local:browser:smoke
```

A verification command that runs and exits unsuccessfully is a deterministic
failure. A missing command or browser check that has not run is inconclusive.
The report does not infer that either outcome was caused by the documentation.

## Connected Provider Accounts

The website never receives provider credentials. A future advanced local
connected run may use official provider tooling in the user's environment, but
Docs Trials cannot prove that an external local coding agent is isolated from
credentials already present on that machine. Such runs must disclose that
boundary and should use a dedicated test account or narrowly scoped temporary
authorization. Hosted supported profiles instead use Docs Trials-owned
ephemeral resources under ADR 0008.
