# Session Context

Updated: 2026-08-21

Replace this handoff after substantial work. Never exceed 50 lines.

## Last Session Summary

- Committed the product contract, domain language, ADRs, guidance, and Linux/Node 22 CI.
- Corrected claims that external run storage prevents same-user access or tampering.
- Vendored the generic anti-slop Oxlint plugin at `tools/oxlint/anti-slop/`.
- Oxlint and `@oxlint/plugins` are pinned at 1.79.0; Effect rules are not enabled.
- `pnpm lint` runs ESLint and Oxlint. Owned source passes every enabled rule.
- Run records now reject a manifest that does not match `manifestDigest`.
- Digest validation detects inconsistency. It does not authenticate same-user records.
- `latest` now selects validated records by `preparedAt`, then by run ID for ties.
- Verification no longer performs a discarded first resolution of `latest`.
- Six run-store regressions cover ID/path reads, digest mismatch, ordering, and corruption.
- A built CLI trial selected newer `aa-new` over older `zz-old` and observed 8 checks pass.
- A changed disposable manifest was refused before commands ran; no report was written.

## Next Session Work

1. Add a regression where a required same-origin asset returns 404.
2. Add the `resource-loads` check defined in `docs/PRODUCT.md` and fix that false pass.
3. Run both linters, typecheck, tests, build, and a real trial; read its report.
4. Continue through the remaining blocker order in the private reviews.

Do not start Gate 2 while any known false-pass path remains.

## Required Files

- `AGENTS.md`, `CONTEXT.md`, `docs/PRODUCT.md`, and `README.md`
- `src/core/outcome.ts`, `src/checks/index.ts`, and `src/checks/page.ts`
- `src/core/run.ts`, `src/checks/preview.ts`, and `src/core/redact.ts`
- `tests/baseline.test.ts`, `tests/run.test.ts`, and `fixtures/sample-app/server.mjs`
- `~/.docs-trials/reviews/ADVERSARY-REPORT.md` and `ENGINEER-REPORT.md`

## Blockers

- Ten consolidated review defects remain after the digest and `latest` fixes.
- Private review findings still include run-ID collisions, non-atomic writes, and path risks.
- npm `docs-trials` is not published or reserved.
- Port 5173 has an unrelated Vite listener; avoid it in real trials.
