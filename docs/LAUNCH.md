# v0.1.0 Launch Checklist

Updated: 2026-09-29. Status: pre-release; npm publication remains owner work.

## Release Candidate

- [x] Push the process-ownership fix and installation preparation.
- [x] Resolve PR #3 against current `main`, retain the approved design and
      accurate pre-release copy, pass all four CI jobs, and merge.
- [x] Pass merged-commit CI on Linux Node 22, 24, and 26, and macOS Node 22.
- [x] Pass lint, formatting, type checking, 219 tests, build, package installation,
      matching Chromium setup, and `pnpm release:publish:dry-run`.
- [x] Pass real static HTML, Vite, Astro, and Next.js framework smoke trials.
- [x] Review the exact five-file npm upload set.
- [x] Complete and independently audit ten fresh, unsteered Gate 2 attempts with
      this candidate: 97 passed checks, with three build checks explicitly omitted.

Frozen candidate: `release/docs-trials-0.1.0.tgz` (134,900 bytes).

SHA-256: `5ca63779a37de6ef1cf32ea9320109269ac246184137a8d8fb34cf01cbbc678c`.

Upload set: `LICENSE`, `README.md`, `dist/cli.js`, `dist/cli.js.map`, and
`package.json`. A private frozen copy and validation logs are retained in
`~/.docs-trials/launch-20260929/`. Recheck the digest after any rebuild. A change
to the verifier requires reassessing affected Gate 2 attempts.

## Current Gate 2 Evidence

The selected ten attempts cover htmx (two), Alpine.js (one), Chart.js (two),
marked (two), Astro (two), and Next.js (one), across static HTML, Vite, Astro,
and the Next.js App Router framework. Four repeated pairs have matching starter,
documentation digests, lifecycle, runtime, and agent/model settings. All 131
report links resolve to retained evidence or frozen documentation. The Next.js
production server served prerendered routes; request-time dynamic rendering was
not demonstrated.

The selected cohort uses OpenCode 1.18.33 with `openrouter/openai/gpt-6-luna`
and Codex CLI 0.159.2 with `gpt-6.1-sol`. Additional sessions remain retained:
one original Chart.js attempt failed network egress for undeclared Google Fonts
origins; account interruptions and an incorrect harness-version preparation
required fresh cohorts. Selection and exclusion reasons are documented privately.
These results are mechanical observations, without task verification, agent
ranking, or documentation causality claims.

## Website And GitHub

- [x] Deploy the approved static site to the default `workers.dev` address for
      owner review, as authorized in the 2026-09-29 handoff.
- [x] Check production internal targets, external links, and sample evidence.
- [x] Check home and report pages at 320, 375, 768, and 1440 pixels, including
      keyboard focus, skip navigation, anchor position, and report-table scrolling.
- [x] Confirm all seven public sample files match the approved local files.
- [x] Set the GitHub description, topics, and homepage.
- [x] Prepare a draft GitHub release with the exact frozen tarball attached.
- [x] Prepare and check the post-publication copy patch without deploying it.

Website: <https://docs-trials.feedback-signal.workers.dev>.
Sample: <https://docs-trials.feedback-signal.workers.dev/report/>.
Worker version: `0f01d167-bec1-43fa-845d-a23da83dfc76`.
The page accurately says "Not on npm yet."

The GitHub `v0.1.0` release is a draft. Private production QA and the checked
post-publication patch are retained in `~/.docs-trials/launch-20260929/`.

## Owner Acceptance And npm Publication

The 2026-09-08 owner acceptance covered SHA-256
`480b1c4f3ce9e166f31679931b0951be2477108ff2a8dedd79776743c08e2f45`.
It does not accept the changed verifier or current candidate.

- [ ] Review the current Gate 2 reports and retained evidence.
- [ ] Install the exact frozen tarball in a clean environment and run
      `docs-trials install-browser`.
- [ ] Personally complete representative `init`, `prepare`, subject-agent, and
      `verify` flows; read the reports and referenced evidence.
- [ ] Record the accepted current digest, attempt IDs, date, and owner sign-off.
- [ ] Publish npm with owner-controlled publish-time 2FA or an appropriate token.
      Keep credentials out of chat, repository files, and retained artifacts.

No npm package or announcement was published during this session.

## After npm Publication

1. Confirm `npm view docs-trials@0.1.0 version` against the public npm registry.
2. Install the public package in a clean environment; verify CLI help, matching
   Chromium installation, and a real representative trial.
3. Apply `~/.docs-trials/launch-20260929/website-after-npm.patch` after checking
   that it still applies. Run site checks, build, and formatting; commit and push.
4. Redeploy the Worker and confirm installation copy, links, sample evidence,
   and mobile layout in production.
5. Publish the prepared GitHub release only after the package and website checks.
6. The owner posts the announcement with website, sample, npm, and GitHub links.
   State that the baseline checks mechanical web health, without verifying task
   fulfillment or documentation causality. Monitor installation issues afterward.

GitHub Issues and private vulnerability reporting are enabled. A social preview upload remains an optional owner choice.
