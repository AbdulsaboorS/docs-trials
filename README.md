# Docs Trials

Check whether an AI coding agent can build a working integration from your documentation.

Give an agent your docs and a task. Docs Trials records what it built, then runs
deterministic checks against the running application and writes a report.

It runs on your machine. Docs Trials sends no telemetry and does not upload
reports. Project commands and the application can still make network requests.

## Sample

The repository includes a real sanitized Gate 2
[Turnstile attempt report](https://github.com/AbdulsaboorS/docs-trials/blob/main/website/src/pages/report.astro)
and its
[public evidence bundle](https://github.com/AbdulsaboorS/docs-trials/tree/main/website/public/sample).
All nine applicable checks passed. The build check did not apply because the
static starter declared no build command.

Each result links to the command or browser observation that produced it. The
sample also keeps source changes as explicitly ungraded evidence. It does not
claim that the contact-form task was fulfilled.

## Install

For a release that is available on npm, install the CLI and its matching
Chromium build with:

```sh
npm install -g docs-trials
docs-trials install-browser
```

Node 22 or later on macOS or Linux.
On Linux, browser setup can request administrator access to install Chromium's
system dependencies.

## Use

```sh
docs-trials init                 # write trial.json
docs-trials prepare              # freeze the task, print agent instructions
                                 # ... give those instructions to your agent ...
docs-trials verify latest        # run the checks, write AX.md
```

`verify` exits `0` when every check passed, `1` when a check failed, and `2`
when the result is inconclusive. That makes it usable in CI.

The optional operator-only skill is in the
[`skills/docs-trials` directory](https://github.com/AbdulsaboorS/docs-trials/tree/main/skills/docs-trials).
Install that directory through your agent's skill mechanism. Give the subject
agent only the generated `AGENT_INSTRUCTIONS.md`, not the operator skill.

If the verifier process stops and leaves a run locked, use
`docs-trials recover <run>`. Recovery removes lock files only when their
valid recorded local process is no longer running. It refuses malformed or
unattributable metadata in bounded regular lock files unless you pass `--force`.
Force can remove that invalid metadata, but it never bypasses a valid owner that
may still be running. Invalid lock paths, such as symlinks, directories, or
oversized files, require manual inspection. Because ownership uses process IDs,
PID reuse can also require manual inspection before recovery is possible.

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
The client-secrets check is inconclusive when a textual response cannot be
decoded reliably or when a WebSocket is observed because its messages are not
captured.
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

## Investigate an attempt

Start with a result's evidence link. Confirm that the retained observation
supports the result detail before you investigate a possible cause.

| Result area                                         | Evidence to inspect                            | Next step                                                                                           |
| --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| install or build                                    | `evidence/install.txt` or `evidence/build.txt` | Find the first command error and reproduce the declared command in the disposable workspace.        |
| boot                                                | `evidence/boot.txt`                            | Check the start output, exact URL, HTTP status, and listener ownership observations.                |
| page, content, console, assets, or server responses | `evidence/browser.txt`                         | Check navigation, visible-content, console, request, and response observations for the named check. |
| client secrets                                      | `evidence/browser.txt`                         | Inspect the content-scan finding or capture gap. Do not publish a detected value.                   |
| network egress                                      | `evidence/browser.txt` and `run.json`          | Compare observed external origins with the frozen allowlist.                                        |
| source changes                                      | `evidence/source-diff.txt`                     | Use the ungraded diff as context only. It did not produce a check result.                           |

For an inconclusive result, identify the missing evidence or infrastructure
problem stated in the detail, correct it, and create a new attempt. Do not turn a
check failure into a documentation finding until the evidence supports that
attribution.

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
  sandboxed. They can read same-user files and make unrestricted network
  requests. The browser origin allowlist observes traffic; it does not block it.
  Use an isolated account or virtual machine for untrusted projects.
- **Lifecycle commands must stay in the foreground.** Detached daemons and
  containers can outlive verification because v0 has no process isolation.

## Status

Docs Trials is distributed as a local CLI with an optional operator skill and an
inspectable public sample. There is no hosted mode, comparison view, or
task-specific verification.

Read the
[product contract](https://github.com/AbdulsaboorS/docs-trials/blob/main/docs/PRODUCT.md)
for methodology and limits, and the
[security policy](https://github.com/AbdulsaboorS/docs-trials/blob/main/SECURITY.md)
before running project commands.

The previous Cloudflare Workers implementation is archived at the
`archive/cloud-path-v0` tag.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
