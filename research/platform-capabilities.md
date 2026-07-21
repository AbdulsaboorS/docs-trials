# Platform Capabilities To Verify

## Status

Retrieved 2026-07-20. These findings identify the narrow APIs needed for the
first implementation; they are not a replacement for each product's reference
documentation.

| Capability          | Status                                           | Intended use                            | Confirmed interface or constraint                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cloudflare/think` | confirmed, integration work needed               | Controlled coding-agent harness         | Think supports turn-level tool restrictions, tool-call interception, bounded steps, and idempotent programmatic submissions. Its built-in bash workspace has no network by default. A Linux Sandbox must be exposed through a custom tool; there is no documented ready-made Think-to-Sandbox coding adapter.    |
| Agents SDK          | confirmed                                        | Persistent agent state and UI streaming | Agents run on Durable Objects and provide durable identity, state, WebSockets, sessions, and Workflow integration. Keep event payloads small; stream logs as events instead of replacing full state.                                                                                                             |
| Sandbox SDK         | confirmed, deployment spike needed               | Isolated code execution and preview     | Current configuration requires a Container entry, matching Durable Object binding/migration, and Sandbox export. Use RPC transport, explicit sessions, absolute file paths, bounded `exec()`, process cleanup, and `destroy()`. Current preview guidance uses Sandbox tunnels; `exposePort()` is being removed.  |
| Browser Run         | confirmed with spike required                    | Browser verification                    | `@cloudflare/playwright` supports sessions, pages, screenshots, tracing, and beta rrweb session recording. Recordings are not native video and are available after session closure. Close launched sessions in `finally`; verify media-device behavior separately before RealtimeKit grading.                    |
| Artifacts           | live Git path confirmed; purge semantics unknown | Versioned trial package storage         | A live disposable repo confirmed implicit namespace creation, scoped read/write tokens, Git clone/push, two-revision history, prior-revision reads, and immediate control-plane deletion. Repo metadata did not reflect successful pushes, and physical purge/token invalidation after deletion remain unproven. |
| Workflows           | confirmed                                        | Durable trial phases                    | Put durable work inside awaited `step.do()` calls, keep deterministic step names, and return structured-cloneable values under 1 MiB. Steps may execute more than once, so every external write needs its own idempotency key/check. Runtime inputs still require schema validation.                             |
| AI Gateway          | confirmed                                        | Model tracing and cost controls         | AI Gateway provides provider routing and request observability. Model requests must include a run correlation ID and must never persist credentials in trial evidence.                                                                                                                                           |
| Kumo                | confirmed, registry access required              | Interface primitives                    | `@cloudflare/kumo` is React and Tailwind based. Its documented installation requires Cloudflare's private npm registry; do not make dashboard build mandatory until registry access is configured.                                                                                                               |
| Tailwind CSS v4     | confirmed                                        | Styling                                 | Tailwind v4 is compatible with the React dashboard build. Use semantic Kumo tokens when Kumo is available.                                                                                                                                                                                                       |

## Sources

| Capability        | Source                                                                                      | Retrieved  |
| ----------------- | ------------------------------------------------------------------------------------------- | ---------- |
| Think             | [Think harness](https://developers.cloudflare.com/agents/harnesses/think/)                  | 2026-07-20 |
| Agents SDK        | [Agents SDK documentation](https://developers.cloudflare.com/agents/)                       | 2026-07-16 |
| Sandbox SDK       | [Sandbox SDK](https://developers.cloudflare.com/sandbox/)                                   | 2026-07-20 |
| Browser Rendering | [Browser Run Playwright](https://developers.cloudflare.com/browser-run/playwright/)         | 2026-07-20 |
| Artifacts         | [Artifacts](https://developers.cloudflare.com/artifacts/)                                   | 2026-07-21 |
| Workflows         | [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) | 2026-07-20 |
| AI Gateway        | [AI Gateway](https://developers.cloudflare.com/ai-gateway/)                                 | 2026-07-16 |
| Kumo              | [Kumo guidelines](https://wiki.cfdata.org/spaces/~cmateus/pages/1386220207/Kumo+Guidelines) | 2026-07-16 |
| Tailwind CSS v4   | [Tailwind CSS documentation](https://tailwindcss.com/docs)                                  | 2026-07-16 |

## Implementation Decisions

- Local evidence packages remain authoritative for local development and CI,
  but they are not a storage substitute for controlled cloud runs. Cloud
  execution stays disabled until binding-driven Artifacts persistence and ADR
  0007's remaining controls are live-validated.
- Browser Run decides browser acceptance criteria in code. A session recording is evidence, not a grading mechanism.
- The first dashboard uses the same report JSON served by the Worker. Kumo is loaded only when its private registry is available; the headless trial path must not depend on it.
- A deployment spike must verify Sandbox preview proxying, two isolated browser contexts, and the media substitute before a RealtimeKit run can be considered valid.
- A paid-account deployment was retried on 2026-07-20 with account
  `be19a16e5d1b66ff19c4e9a90096344e`. Assets uploaded, but Worker deployment
  stopped with Cloudflare API error `10015`: Artifacts is not enabled. No
  controlled cloud run was permitted while this entitlement remained unresolved.
- On 2026-07-21, `wrangler artifacts namespaces list` successfully reached the
  private-beta API and initially reported no namespaces. Current namespace docs
  clarify that namespaces are created implicitly by the first repository; there
  is no separate namespace-creation API or Wrangler command.
- Wrangler 4.111.0 exposes namespace `list` and `get`, plus repository `create`,
  `list`, `get`, `delete`, and `issue-token`. A live disposable repository
  confirmed those control-plane operations and the Git data path. Do not use
  repository `last_push_at` as evidence of persistence: it remained `null` after
  two successful pushes that a fresh clone retrieved.

## 2026-07-20 Smoke-Path API Notes

- **Think:** use bounded active tools and `beforeToolCall()` enforcement. Start
  programmatic work with an idempotency key. The controlled agent needs a
  custom, traceable Sandbox tool rather than assuming Think's built-in bash is
  the Linux build environment.
- **Sandbox:** pin compatible SDK/container versions, add the required
  Container configuration before deployment, use RPC transport and explicit
  sessions, and terminate timed-out processes because an `exec()` timeout alone
  does not kill the process. Preview services must bind to `0.0.0.0`; the
  deployed spike must choose and validate a current tunnel strategy.
- **Browser Run:** save screenshot bytes separately from the beta rrweb session
  recording reference. Recording becomes available only after the session is
  closed and is retained by Browser Run for 30 days.
- **Workflows:** freeze validated inputs during `prepare`; use stable run/phase
  idempotency keys for Artifacts and other side effects. Do not perform durable
  side effects outside `step.do()` callbacks.
- **Artifacts:** validate namespace/repository creation first. Persisting a
  versioned file tree requires Git clone/commit/push from an appropriate
  environment using a short-lived repository-scoped token.
- **Admission controls:** Access, Turnstile, Workers rate limiting, AI Gateway
  spend limits, and platform concurrency limits can add protection, but none is
  an exact atomic budget across every product used by one trial. Docs Trials
  must own that admission record as required by ADR 0007.

Additional primary sources retrieved 2026-07-20:

- [Think lifecycle hooks](https://developers.cloudflare.com/agents/harnesses/think/lifecycle-hooks/)
- [Agents Sandbox tools](https://developers.cloudflare.com/agents/tools/sandbox/)
- [Sandbox 2026 deprecation guide](https://developers.cloudflare.com/sandbox/guides/2026-deprecation/)
- [Sandbox tunnels](https://developers.cloudflare.com/sandbox/api/tunnels/)
- [Browser Run session recording](https://developers.cloudflare.com/browser-run/features/session-recording/)
- [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Artifacts Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)
- [Artifacts Git protocol](https://developers.cloudflare.com/artifacts/api/git-protocol/)
- [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)

## 2026-07-21 Artifacts Live Spike

The spike used Wrangler 4.111.0 against account
`be19a16e5d1b66ff19c4e9a90096344e`. It did not deploy a Worker or invoke Think,
Sandbox, Browser Run, or a Workflow.

1. `wrangler artifacts repos create docs-trials-spike-20260721 --namespace
docs-trials` created both the first repository and its previously absent
   namespace. This matches the current namespace documentation: namespace
   creation is implicit on first repository creation.
2. Wrangler returned the repository remote plus an initial token. The spike did
   not print or persist plaintext tokens. It issued separate 600-second `write`
   and `read` tokens and supplied them to Git through a process-scoped HTTP
   authorization header.
3. A write token cloned the empty smart-HTTP remote and pushed two commits to
   `main`. A fresh clone with a read-only token retrieved both commits, the
   current `revision: 2` file, and the prior `revision: 1` file by commit.
4. Repository metadata still reported `last_push_at: null` and its original
   `updated_at` after both pushes. Git retrieval, not repository metadata, is
   therefore the observed source of truth for persisted revisions.
5. `wrangler artifacts repos delete --force --json` returned `deleted: true`.
   An immediate get returned `10200 Repository not found`, repository listing
   returned empty, and the retained namespace reported `repo_count: 0`.
6. The documented REST delete route returns `202 Accepted`. The observations
   prove immediate control-plane and read-path unavailability, but do not prove
   when physical data is purged or whether previously issued tokens are revoked
   independently of the missing repository. Treat hard deletion as an open
   release gate.

Primary sources retrieved 2026-07-21:

- [Artifacts namespaces](https://developers.cloudflare.com/artifacts/concepts/namespaces/)
- [Artifacts REST API](https://developers.cloudflare.com/artifacts/api/rest-api/)
- [Wrangler Artifacts commands](https://developers.cloudflare.com/workers/wrangler/commands/artifacts/)
- [Artifacts dashboard management changelog](https://developers.cloudflare.com/changelog/post/2026-06-17-dashboard-management/)

## Retrieval Protocol

For each capability:

1. Retrieve the current primary documentation.
2. Record source URL and retrieval date.
3. Record only the exact API shape needed for the next phase.
4. Add a small spike or test before coupling the main application to it.
5. Update this table from assumption to confirmed, blocked, or rejected.
