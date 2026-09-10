# Agent Experience Report: Sanitized Handoff Copy

**BASELINE INCONCLUSIVE**

**Task fulfillment was not verified.**

- Trial: Static Release Notes Page
- Run: `final-static-3-20260908-154337-509`
- Checks: 9 passed, 0 failed, 1 inconclusive
- Verification time: 10s
- Agent: OpenCode (openai/gpt-5.6-sol)
- Verifier: Docs Trials 0.1.0 (schema 1); v26.7.0 on darwin 25.5.0 (arm64)
- Prepared with: Docs Trials 0.1.0 (schema 1); v26.7.0 on darwin 25.5.0 (arm64)
- Manifest digest: `7cb3cd4b5cab35a5`
- Baseline revision: `72497dcbc693`

## Task

Using only the supplied page requirements, replace the starter with a polished static release-notes page.

## Documentation Supplied

- Page requirements: [public handoff copy](documentation/001-page-requirements.txt) (inline trial text)
  The original frozen copy was retrieved at 2026-09-08T15:43:37.513Z and recorded as 403 bytes with SHA-256 `0e7b1e626072a8415fba12ef851824b672246ab94149852107823d2c227192c8`. The 404-byte public copy has a trailing newline and SHA-256 `72913d328b0ae64f56be81d17300fa8a128827095ddc0f1f5a8f7ca90840a620`.

## Baseline Checks

These are the only results Docs Trials produced. Each one is code that ran.

| Result | Check                                                             | Detail                                                                                            | Evidence                         |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| PASS   | Dependencies install successfully.                                | Dependency installation completed in 1s.                                                          | [install](evidence/install.json) |
| PASS   | The project builds successfully.                                  | Build completed in 1s.                                                                            | [build](evidence/build.json)     |
| PASS   | The application starts and answers an HTTP request.               | http://localhost:55129 answered with HTTP 200.                                                    | [boot](evidence/boot.json)       |
| PASS   | The entry page loads without an HTTP or navigation error.         | The entry page returned HTTP 200 with title "Northstar Release Notes".                            | [browser](evidence/browser.json) |
| PASS   | The page renders visible content.                                 | The page rendered visible text.                                                                   | [browser](evidence/browser.json) |
| PASS   | No uncaught or application console error occurs.                  | No uncaught or application console error.                                                         | [browser](evidence/browser.json) |
| PASS   | Same-origin browser assets load successfully.                     | Same-origin browser assets loaded.                                                                | [browser](evidence/browser.json) |
| PASS   | No request returns a 5xx response.                                | No response returned a 5xx status.                                                                | [browser](evidence/browser.json) |
| N/A    | Captured same-origin browser content contains no detected secret. | 1 WebSocket channel was observed, but channel messages were not captured for credential scanning. | [browser](evidence/browser.json) |
| PASS   | The page contacts no unexpected external origin.                  | The page contacted no external origin.                                                            | [browser](evidence/browser.json) |

## Observed Failures

No baseline check failed.

## Unresolved Checks

- **Captured same-origin browser content contains no detected secret.** 1 WebSocket channel was observed, but channel messages were not captured for credential scanning.

An unresolved check means Docs Trials lacked evidence. It does not mean the
documentation failed.

## Ungraded Observations

- Git-visible source changes against the prepared baseline were recorded in the original local attempt. Evidence: [sanitized source-diff note](evidence/source-diff.txt)
- Git-ignored workspace paths were excluded from source evidence.

These facts did not change a baseline check result. The redundant full source
diff is omitted from this sanitized handoff because `../subject/index.html`
contains the resulting source.

## Author Goals: Not Verified

The manifest author listed this outcome. Docs Trials did **not** check it.

- The entry page presents the supplied release-note content in a readable responsive layout.

## How To Read This Report

- **PASS** means Docs Trials observed the required behavior.
- **FAIL** means Docs Trials observed behavior that contradicts the check.
- **N/A** means there was not enough evidence to decide. It is not a documentation finding.

The baseline checks are generic. They test that the integration installs,
builds, boots, loads, renders visible content, loads browser assets, and does not
contain a detected credential in captured same-origin content. They do not test
whether the application fulfills the task.
