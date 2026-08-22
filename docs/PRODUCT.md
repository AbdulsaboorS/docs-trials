# Docs Trials Product Contract

Status: Confirmed direction. This document describes the target product. The
current implementation still has the blockers listed in `SESSION_CONTEXT.md`.

## Position

**Can an agent actually build from your docs?**

Run a real coding agent against your documentation. Verify what it builds. Turn
failures into changes you can test.

Static agent-readiness scanners inspect document structure and protocols. Docs
Trials differentiates itself by observing a built and running application.

## Primary Operator

The first operator is a documentation engineer, developer advocate, SDK
maintainer, or API team testing a public web-integration guide.

## Product Contract

v0 tests whether a browser-based web application is mechanically healthy. It
does not prove task fulfillment or documentation causality.

- The subject agent is external and manually operated.
- Documentation-only access is requested but not enforced.
- One attempt is a diagnostic observation, not a benchmark or agent ranking.
- Execution is local, unsandboxed, and supported on macOS and Linux.
- Operators use disposable workspaces and explicitly allow environment names.
- Missing evidence and infrastructure trouble are inconclusive.
- No score represents overall documentation or agent readiness.

## Operator Flow

1. Install the npm CLI and its matching Chromium build.
2. Create or open a disposable starter web project.
3. Run `docs-trials init` and confirm detected project commands.
4. Define the task, documentation, allowed origins, and agent identity.
5. Run `docs-trials prepare` to freeze the trial and instructions.
6. Give the instructions to the subject agent.
7. Let the subject agent change the starter project.
8. Run `docs-trials verify` to create an immutable attempt.
9. Read the report, evidence, limitations, and investigation guidance.
10. Change documentation, repeat the trial, and compare attempts when useful.

## Trial Input

A prepared trial freezes:

- task, title, and ungraded author goals;
- applicable check set;
- documentation snapshots and provenance;
- confirmed install, build, start, and entry-page configuration;
- allowed external origins and environment-variable names;
- workspace baseline revision;
- agent product and optional model;
- CLI and schema versions.

When retrieval succeeds, the subject agent uses the frozen documentation copy.
The original URL remains attribution. When retrieval fails, the trial can use
the live source but must mark provenance incomplete.

Never store secret values in the manifest. Resolve approved variable names from
the operator's environment during verification.

## Applicable Checks

The prepared trial contains only checks that apply to its declared lifecycle.
An omitted optional step is listed outside the result set with its reason. It
does not require a fake command or a fourth outcome.

| Check              | Pass condition                                                |
| ------------------ | ------------------------------------------------------------- |
| install            | The declared install step exits successfully                  |
| build              | The declared build step exits successfully                    |
| boot               | The declared application answers at its exact URL             |
| page load          | The entry page navigates without an HTTP error                |
| visible content    | The page renders text or a meaningful visual surface          |
| application errors | No uncaught or application console error occurs               |
| resource loads     | Same-origin browser asset requests do not fail                |
| server errors      | No observed response returns a server error                   |
| client secrets     | Complete captured browser content contains no detected secret |
| network egress     | External origins match the frozen allowlist                   |

Visible content can be text, an image, SVG, canvas, video, iframe, or form
control. A structural DOM shell alone is not content.

The browser observes the entry page for a bounded period frozen in the
manifest. It does not click controls or let a model explore. Task-specific
actions belong to a later approved-check system.

## Outcomes And Reports

Each check produces `passed`, `failed`, or `inconclusive`. A failed check takes
precedence. Missing or duplicate applicable checks make the attempt
inconclusive.

A healthy report starts with `BASELINE PASSED` and immediately states that task
fulfillment was not verified. The report links every result to evidence and
lists ungraded observations explicitly.

Each `verify` creates an immutable attempt. It never overwrites earlier
evidence. Every attempt records the CLI, operating system, Node version, agent
product, optional model, starter revision, documentation digests, commands, and
timestamps.

Immutability describes CLI behavior. Local attempt files are not authenticated
against another process that uses the operator's account.

## Findings And Recommendations

A check failure is a fact about an attempt. It becomes a documentation finding
only when evidence supports that attribution.

Recommendations are advisory and separate from results. Each recommendation
contains:

- observation and linked evidence;
- exact documentation location and quotation when available;
- possible cause;
- proposed change;
- confidence;
- validation step.

v0 can provide deterministic, evidence-linked investigation guidance. It does
not ship model-generated recommendations.

## Product Learning

The verifier never trains or modifies itself from user feedback. Deterministic
checks change only through reviewed, tested, and versioned source releases.

Gate 2 defines and tests structured feedback fields. A useful feedback record
asks whether a finding was accurate, whether guidance was useful, whether docs
changed, and whether a controlled follow-up attempt improved.

The strongest learning signal is a documentation change linked to an improved
follow-up attempt. A general thumbs-up is secondary evidence.

v0 sends no automatic telemetry. A later service can accept explicit opt-in
feedback. Feedback can improve advisory prompts, examples, and proposed checks,
but cannot change stored outcomes.

## Security And Trust

- Commands execute with the operator's user account and are not sandboxed.
- Lifecycle commands must remain in the foreground. Detached processes are unsupported.
- Runs outside the workspace prevent baseline contamination, not same-user
  access.
- Commands receive a safe base environment plus explicitly approved names.
- Evidence is redacted before writing, but redaction is not an isolation layer.
- Publishing is always explicit and shows the exact upload set first.
- A public local-run report is evidence, not a trusted remote attestation.

## Gate 2

Gate 2 uses one frozen release candidate for ten unsteered attempts:

- six documentation products;
- four products repeated with a second agent product;
- static HTML, Vite, Astro, and one server-rendered framework;
- a fixed environment within each repeated pair;
- no agent leaderboard.

Gate 2 succeeds when all reports classify observations honestly, retain
complete evidence, and help explain what happened. Applications do not need to
pass. A verifier change invalidates affected release-candidate attempts and
requires rerunning them.

## v0 Release

The first public release contains:

- npm CLI;
- optional operator skill;
- Astro landing page on Workers Static Assets;
- one real, sanitized sample report;
- GitHub source, methodology, limits, and security policy;
- evidence-linked investigation guidance.

The npm package is the software. `npx` is an optional way to execute that
package. The operator skill explains how to use the CLI but cannot replace it.
The subject agent must not receive the operator skill.

The landing page leads with a real report, then explains the three-step flow,
installation, checked and unchecked behavior, local security, methodology,
GitHub, npm, and license. It contains no unsupported testimonials or scores.

## Cloudflare Scope

The current CLI uses no Cloudflare product.

v0 uses Workers Static Assets only. Astro builds static HTML. It does not need
the Cloudflare Astro adapter, server rendering, a database, or an API.

After local v0 has users, optional publishing can add:

| Product    | Later role                                                    |
| ---------- | ------------------------------------------------------------- |
| Workers    | Upload and report APIs                                        |
| R2         | Immutable report and evidence bundles                         |
| D1         | Report metadata, visibility, deletion, and comparison records |
| Turnstile  | Abuse protection for anonymous browser actions                |
| Workers AI | Optional advisory recommendation generation                   |
| AI Gateway | Optional model routing, limits, and observability             |
| Access     | Optional private administration                               |

Do not use Workflows, Durable Objects, Sandbox, Containers, Browser Run, Agents
SDK, or AI Search for v0. Hosted execution is a separate future product decision.

## Engineering Quality

Vendor the anti-slop Oxlint plugin and run it beside ESLint. Migrate owned source
without suppressing rules. Compare coverage before removing ESLint. Do not load
the Effect rules because this project does not use Effect.

The initial framework matrix is static HTML, Vite, Astro, and one
server-rendered framework. Fixed test ports must be removed. CI covers supported
Node versions and operating systems before release.

## Implementation Order

1. Commit durable decisions and the existing CI workflow.
2. Vendor Oxlint, migrate source, and make both linters pass.
3. Add regression tests and fix all 12 known blockers.
4. Re-run both adversarial reviews.
5. Complete Gate 2 with one release candidate.
6. Finalize package installation and browser setup.
7. Publish the operator skill, sample report, and Astro landing page.
8. Publish npm v0 only after all release evidence is complete.
