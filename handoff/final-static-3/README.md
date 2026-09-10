# Final Acceptance Handoff

This bundle carries the final acceptance subject and a sanitized evidence copy
to another checkout. The release state and next action remain in
`SESSION_CONTEXT.md` and `docs/LAUNCH.md`.

## Resume

From `handoff/final-static-3/subject`:

Use Node 22.12 or later.

```sh
npm install
npm run build
npm run dev -- --port 55129 --strictPort
```

Open `http://localhost:55129` while the foreground server is running. The page
can also be opened directly from `subject/index.html`. If port 55129 is occupied,
choose an available port and update both `run.start` and `run.url` before
preparing a new trial.

## Provenance

- Attempt: `final-static-3-20260908-154337-509`
- Result: 9 passed, 0 failed, 1 inconclusive
- Original attempt directory: `~/.docs-trials/runs/final-static-3-20260908-154337-509/`
- Original tarball SHA-256: `480b1c4f3ce9e166f31679931b0951be2477108ff2a8dedd79776743c08e2f45`
- Public documentation-copy SHA-256: `72913d328b0ae64f56be81d17300fa8a128827095ddc0f1f5a8f7ca90840a620`

This is not the original attempt directory. The public copy omits absolute
local paths, process IDs, generated dependencies, build output, and the
redundant full source diff. The original attempt remains on the source laptop.
Its immutability means the CLI does not overwrite it; it is not authenticated
against another same-user process. The subject package name and dependency
range match the accepted subject, and `package-lock.json` preserves the resolved
dependency versions.

No npm publication or production website deployment has been approved.
