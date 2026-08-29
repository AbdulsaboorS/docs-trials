Docs Trials public sample evidence

Attempt: gate2-turnstile-a-20260827-190642-913
Verifier revision: 62c1d0c55bf432c3dea605dd45748c2a3770db18
Outcome: 9 passed, 0 failed, 0 inconclusive; build omitted

This directory is a sanitized public copy of result-bearing evidence from one
real Gate 2 attempt. The public report is /report/.

The sample is inspectable but not independently rerunnable. It does not include
the starter workspace, unchanged source files, lockfile, or frozen documentation
bodies.

Sanitization:
- Local absolute paths are not included.
- Ephemeral process IDs in boot evidence are replaced with [process-id].
- Repeated stable listener-owner samples are summarized in boot.json.

No check outcome, observed HTTP status, duration, browser observation, source
change, command, or evidence relationship was changed.

Frozen documentation bodies are not republished. Their source URLs, retrieval
times, byte lengths, content types, HTTP statuses, and SHA-256 digests appear on
the report page. The live URLs are attribution only and can change after the
attempt.

The source diff contains Cloudflare's published always-pass Turnstile test key
pair. These values are public test fixtures, not operator credentials.

Files:
- manifest.json: frozen trial inputs, commands, allowlist, and agent identity.
- results.json: machine-readable check results emitted by Docs Trials.
- evidence/install.json: complete install observation.
- evidence/boot.json: sanitized boot observation.
- evidence/browser.json: complete browser observation.
- evidence/source-diff.txt: complete Git-visible source diff.
