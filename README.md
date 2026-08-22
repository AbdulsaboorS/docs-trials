# Docs Trials

Check whether an AI coding agent can build a working integration from your documentation.

Give an agent your docs and a task. Docs Trials records what it built, then runs
deterministic checks against the running application and writes a report.

It runs on your machine. Nothing is uploaded.

## Why

A build that exits `0` proves very little. Here is a real run against the
[TanStack Query quick start](https://tanstack.com/query/latest/docs/framework/react/quick-start).
The last line of that page is `render(<App />, document.getElementById('root'))`,
which is the React 17 API. An earlier eight-check trial observed this:

```txt
FAILED — 7 passed, 1 failed, 0 inconclusive

  PASS  Dependencies install successfully.
  PASS  The project builds successfully.
  PASS  The application starts and answers an HTTP request.
  PASS  The entry page loads without an HTTP or navigation error.
  FAIL  The page raises no uncaught error or console error.
        1 application error. First: render is not a function
  PASS  No request returns a 5xx response.
  PASS  No credential-shaped value appears in browser-delivered assets.
  PASS  The page contacts no unexpected external origin.
```

The project installs. The project builds. The server answers with HTTP 200. The
page is blank. Only a browser catches it.

## Install

```sh
npm install -g docs-trials
npx playwright install chromium
```

Node 22 or later.

## Use

```sh
docs-trials init                 # write trial.json
docs-trials prepare              # freeze the task, print agent instructions
                                 # ... give those instructions to your agent ...
docs-trials verify latest        # run the checks, write AX.md
```

`verify` exits `0` when every check passed, `1` when a check failed, and `2`
when the result is inconclusive. That makes it usable in CI.

### trial.json

```json
{
  "version": 1,
  "id": "checkout-quickstart",
  "title": "Checkout quickstart",
  "task": "Using only the supplied docs, add a checkout page to this app.",
  "docs": [{ "label": "Quickstart", "url": "https://example.com/docs/quickstart" }],
  "goals": ["A customer can reach the success page."],
  "run": {
    "install": "npm install",
    "build": "npm run build",
    "start": "npm run dev -- --port 5173 --strictPort",
    "url": "http://127.0.0.1:5173",
    "observationWindowSeconds": 5
  },
  "allowedOrigins": ["https://api.example.com"],
  "allowedEnvironment": ["EXAMPLE_API_KEY"]
}
```

Lifecycle commands receive a small base environment plus only the variable
names listed in `allowedEnvironment`. The manifest and report never store their
values.

`goals` are recorded in the report and **never graded**. Only the checks below
produce a result.

## What is checked

| Check              | Passes when                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| install            | The install command exits `0`.                                           |
| build              | The build command exits `0`.                                             |
| boot               | The start command brings up a server that answers an HTTP request.       |
| page load          | The entry page navigates and returns a status below 400.                 |
| visible content    | The page renders text or a meaningful visual surface.                    |
| application errors | No uncaught exception and no application `console.error`.                |
| resource loads     | Same-origin browser assets load without an HTTP or network failure.      |
| server errors      | No response returns a 5xx status.                                        |
| client secrets     | Complete same-origin response bodies contain no detected credential.     |
| network egress     | Every external origin the page contacts is declared in `allowedOrigins`. |

These are generic. They need no per-task authoring and work on any web
application. They test that the integration installs, builds, boots, renders,
loads browser assets, and does not leak detected credentials in
same-origin responses. Fetch and XHR failures are not graded as browser asset
failures. The browser observes the page for the period frozen in the manifest.
When no build command is declared, the build check is listed as omitted and
receives no outcome.

**They do not test whether the application fulfils your task.** Docs Trials
will not claim otherwise.

## Three outcomes

- **passed** — the check observed the required behaviour.
- **failed** — the check observed behaviour that contradicts it.
- **inconclusive** — there was not enough evidence to decide.

A port that was already busy, a browser that would not start, or a step skipped
because an earlier one failed all produce `inconclusive`. An inconclusive result
is not a documentation finding.

## Evidence

Each run writes to `~/.docs-trials/runs/<run-id>/`:

```txt
run.json                 frozen manifest, digest, baseline revision, results
AGENT_INSTRUCTIONS.md    exactly what the agent was given
AX.md                    the report
results.json             machine-readable check results
evidence/install.txt     install output
evidence/build.txt       build output
evidence/boot.txt        start command output
evidence/browser.txt     console, network, origins, captured assets, body text
evidence/source-diff.txt what the agent changed, against the Git baseline
```

Runs are stored outside your workspace so Docs Trials does not dirty the Git
baseline it records. This does not isolate runs from processes that use your
operating-system account. Attempt immutability prevents later CLI writes; it
does not authenticate files against same-user tampering. Evidence is redacted
before it is written.

## Limits

Read these before you trust a result.

- **The model already knows your docs.** A frontier model can build a Stripe
  integration without reading Stripe's documentation. Docs Trials cannot
  separate what the agent read from what it already knew. Results are most
  meaningful for new products, new versions, and recently changed APIs.
- **One run is a diagnostic, not a benchmark.** Agents are stochastic. Compare
  variants only across repeated runs with one deliberate change.
- **Nothing enforces which docs the agent read.** The manifest tells the agent
  what to use. It cannot stop it searching.
- **The checks are generic.** Passing means the integration works mechanically,
  not that it does what you asked.
- **Commands run on your host.** `install`, `build`, and `start` are not
  sandboxed. Use a disposable workspace and remove provider credentials.
- **Lifecycle commands must stay in the foreground.** Detached daemons and
  containers can outlive verification because v0 has no process isolation.

## Status

Early. The CLI works end to end and the checks above are real. There is no
hosted mode, no comparison view, and no task-specific verification yet.

The previous Cloudflare Workers implementation is archived at the
`archive/cloud-path-v0` tag.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
