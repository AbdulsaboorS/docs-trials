# Docs Trials Agent Guide

## Mission

Ship a command line tool that tells a documentation team whether an AI coding
agent can build a working integration from their docs, backed by evidence a
sceptic can check.

## The rule that matters most

**Never report a result the code did not observe.**

An earlier version of this project assigned a shell command's exit code to
whichever author criterion happened to be first. `echo hello` produced a report
that read `PASSED — A customer can complete a Stripe Checkout payment`. That
bug was possible because results were keyed by user text.

Results are now keyed by a `CheckId` defined in `src/core/outcome.ts`. Every
check is code in this package. An author's `goals` are recorded and explicitly
not graded. Keep it that way. If you add a result type, add the check that
produces it first.

## Fixed decisions

- Name: `docs-trials`. Apache-2.0. Public.
- A local CLI. Execution never leaves the user's machine.
- Deterministic checks own the outcome. A model may explain a result. It may
  never change one.
- Three outcomes: `passed`, `failed`, `inconclusive`. Missing evidence is
  `inconclusive`, never `failed`.
- Infrastructure trouble is never reported as an application defect. A busy
  port, an absent browser, or a skipped step is `inconclusive`.
- Runs are stored outside the workspace so the agent under test cannot read the
  manifest or rewrite its own instructions.
- Evidence is redacted before it is written, and redaction masks values without
  rewriting the surrounding text.
- The archived Cloudflare Workers implementation is at tag
  `archive/cloud-path-v0`. Do not resurrect it piecemeal.

## Planned architecture

Execution stays local. Cloud services earn their place on the sharing surface,
not the running surface.

| Stage    | Scope                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| v0 (now) | CLI. Baseline checks. No network dependency.                                                                  |
| v1       | `docs-trials publish` — Worker + R2 + D1 + Turnstile to host a report at a URL.                               |
| v2       | Task-specific checks proposed from the docs, approved by the author, frozen before the run, executed locally. |
| v3       | Hosted runs, if users ask for them. Workflows, Sandbox, Browser Rendering, Containers.                        |

Do not start a later stage before the one before it has users.

## Honesty rules

- State what a check observed, not what it implies.
- A failure is a fact about the run. It becomes a documentation finding only
  when the evidence supports that attribution.
- Every claim in the README must be reproducible by running the tool.
- Do not describe unbuilt capability in the present tense.
- Disclose the limits: pretrained knowledge, run-to-run variance, unenforced
  doc scope, unsandboxed commands.

## Engineering conventions

- TypeScript, strict, `pnpm`, Node 22+.
- Validate anything crossing a process or file boundary with Zod.
- Choose the simplest implementation that meets the current requirement.
- Grow in layers. Add capability to a product that already works.
- Prefer established libraries. Check their types before deciding they lack a
  capability.
- Do not keep backward compatibility. Delete obsolete paths.
- No speculative abstraction. An interface with one implementation and one test
  double is not worth its cost.
- Do not write more than a day of code before running it. This project's worst
  failure was 2,100 lines written before a single deployment.
- Cleanup must never throw away a completed run.
- Comments explain a design decision. They do not narrate a bug fix.

## Critical thinking

- Question the premise before adding to it.
- Say "I do not know" instead of guessing.
- If multiple readings exist, present them rather than picking one silently.
- If a name feels wrong, raise it before committing.

## ASD-STE100 Simplified Technical English

Write documentation and user-facing text in Simplified Technical English.

- One word, one meaning.
- Short sentences. Twenty words or fewer for an instruction.
- Active voice: "Stop the process", not "The process must be stopped".
- One topic per paragraph.

## Validation

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` includes an integration suite that starts real servers and drives a
real Chromium. Install it once with
`pnpm exec playwright install chromium chromium-headless-shell`.

Before you call a change to the check pipeline complete, run a real trial
against real third-party documentation and read the report.
