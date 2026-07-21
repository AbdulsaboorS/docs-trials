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

```sh
pnpm trial:local:prepare -- --manifest trial.manifest.json --workspace .
```

Give the generated `AGENT_INSTRUCTIONS.md` to any coding agent. After it has
worked in the workspace, capture the evidence:

```sh
pnpm trial:local:capture -- --run .docs-trials/runs/<run-id> --workspace .
pnpm trial:local:view -- .docs-trials/runs/<run-id>
```

The first runner validates the user-supplied verification command. Browser
verification is intentionally reported as inconclusive until the local browser
verifier is added.

A verification command that runs and exits unsuccessfully is a deterministic
failure. A missing command or browser check that has not run is inconclusive.
The report does not infer that either outcome was caused by the documentation.
