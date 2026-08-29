---
name: docs-trials
description: Operate Docs Trials to prepare, verify, recover, and interpret local trials of whether coding agents can build from developer documentation. Use when the user asks to run a docs trial, evaluate docs through a built app, or inspect a Docs Trials report. This skill is for the operator agent, not the subject agent.
---

# Docs Trials Operator

Run the CLI as the operator. Give the subject agent only the generated
`AGENT_INSTRUCTIONS.md`; the subject agent must not receive this skill.

## Run A Trial

1. Confirm the workspace is disposable, clean, and committed. Existing changes
   contaminate source evidence; start from a clean committed starter instead of
   attributing them to the subject. Inspect the package scripts and keep
   lifecycle commands in the foreground.
2. Treat project commands as untrusted host commands. They can read other files
   available to the operator's account and use unrestricted network access. Use
   an isolated account or virtual machine when that risk is unacceptable.
3. Remove accessible credentials. Keep only required values in the operator's
   environment; the manifest records their names, never their values. The
   environment allowlist does not restrict filesystem or network access, and the
   origin allowlist observes browser traffic rather than blocking it.
4. Confirm `docs-trials --help` works. Run `docs-trials install-browser` when the
   matching Chromium build is not installed.
5. Run `docs-trials init`, then inspect `trial.json`. Confirm the task,
   documentation URLs, lifecycle commands, exact entry URL, external-origin
   allowlist, environment names, agent identity, and observation window.
6. Write author goals as context only. Do not treat them as checks.
7. Run `docs-trials prepare`. Confirm every documentation source froze
   successfully and inspect the generated instructions.
8. Start a subject-agent session in the prepared workspace. Send the generated
   instructions and let the subject finish before verification.
9. Run `docs-trials verify latest`. Preserve the immutable attempt directory even
   when verification fails or is inconclusive.
10. Read `AX.md`, `results.json`, and each referenced evidence file before
    reporting the outcome.

## Investigate An Attempt

1. Start with the evidence links on the check result. Confirm that the retained
   observation supports the result detail.
2. For install and build results, inspect the corresponding command evidence and
   reproduce the declared command in the disposable workspace.
3. For boot results, inspect start output, the exact URL and HTTP status, and the
   listener ownership observations in boot evidence.
4. For browser results, inspect the navigation, visible-content, console,
   request, response, content-scan, and origin fields used by the named check.
5. Use source-diff evidence as ungraded context only. It did not produce a check
   result.
6. For an inconclusive result, identify the stated evidence gap or infrastructure
   problem, correct it, and create a new attempt.
7. Do not attribute a failed check to the documentation until separate evidence
   supports that finding.

## Interpret Results

- Report each deterministic check as `passed`, `failed`, or `inconclusive`.
- State what the check observed. Do not claim task fulfillment or grade author
  goals.
- List ungraded observations as ungraded.
- Treat a failed check as an attempt fact. Call it a documentation finding only
  when separate evidence supports that attribution.
- Treat one attempt as diagnostic evidence, not an agent score or benchmark.

## Recover A Stopped Verification

Inspect the recorded owner before running `docs-trials recover <run>`. Use
`--force` only for bounded malformed or unattributable lock metadata after manual
inspection. Never remove a lock owned by a process that may still be running.

Read the
[product contract](https://github.com/AbdulsaboorS/docs-trials/blob/main/docs/PRODUCT.md)
for methodology and limits. Read the
[README](https://github.com/AbdulsaboorS/docs-trials/blob/main/README.md) for CLI
usage.
