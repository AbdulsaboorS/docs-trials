# v0.1.0 Launch Checklist

Status: Pre-release

Publication and production deployment require explicit owner approval.

## 1. Finalize The Release Candidate

- [x] Review the release-preparation worktree.
- [x] Commit and push the intended files.
- [x] Confirm CI passes on the release commit.
- [x] Confirm `pnpm release:publish:dry-run` passes.
- [x] Enable and test GitHub private vulnerability reporting.

## 2. Finalize The Website

- [x] Review the landing page, real sample report, and public evidence links.
- [x] Confirm the methodology, limits, security policy, and operator skill agree.
- [x] Run the site check, build, mobile smoke test, and Wrangler dry run.
- [x] Keep the website undeployed until owner acceptance is complete.

## 3. Owner Manual Acceptance

The owner personally tests representative local trials before any npm
publication or production website deployment.

- [ ] Install the release tarball in a clean environment and run
      `docs-trials install-browser`.
- [ ] In disposable starter projects, manually run the complete `init`,
      `prepare`, subject-agent, and `verify` flow.
- [ ] Read each generated report and its referenced evidence.
- [ ] Confirm passed, failed, and inconclusive observations are described
      honestly where the manual trials produce them.
- [ ] Confirm no credential appears in retained evidence and no private local
      path appears in an artifact selected for public release.
- [ ] Record the tested tarball digest, attempt IDs, date, and owner sign-off
      below.

Tarball digest:

Attempt IDs:

Acceptance date:

Owner sign-off:

## 4. Publish And Deploy

- [ ] Give explicit approval for npm publication and website deployment.
- [ ] Run `pnpm release:publish` for `docs-trials@0.1.0`.
- [ ] Install the public npm package in a clean environment and verify the CLI
      and matching Chromium setup.
- [ ] Replace the website's pre-release section with npm installation commands
      and a link to the npm package, then commit it, confirm CI, and rebuild the
      site.
- [ ] Deploy the production website.
- [ ] Test every production link, sample evidence file, and mobile layout.

## 5. Prepare GitHub For Launch

- [ ] Set the repository description, website URL, topics, and social preview.
- [ ] Confirm the public README installation commands work from npm.
- [ ] Create the `v0.1.0` GitHub release with concise release notes.
- [ ] Confirm the public issue-reporting path is ready.

## 6. Announce

- [ ] Post the launch on Twitter/X with the website, sample report, npm, and
      GitHub links.
- [ ] State the core limit: the baseline checks mechanical web health, not task
      fulfillment or documentation causality.
- [ ] Monitor installation reports and issues after launch.
