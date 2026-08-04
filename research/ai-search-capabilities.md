# AI Search Trial Capabilities

Retrieved: 2026-07-21

## Findings

- AI Search namespace bindings can create, access, update, and delete instances
  at runtime. Wrangler describes the binding as full access to one namespace.
- New instances include built-in storage. The Items API supports
  `uploadAndPoll`, allowing a deterministic verifier to wait for indexing
  without adding an R2 data source.
- Wrangler 4.111.0 supports instance and namespace deletion with
  `wrangler ai-search delete` and `wrangler ai-search namespace delete`.
- Every instance can expose an MCP search endpoint, but the current guide and
  public-endpoint configuration page document enablement through the dashboard.
  The public endpoint is unauthenticated and needs synthetic content, strict
  rate limits, and immediate cleanup in this trial.
- AI Search is free during open beta within documented plan limits. Workers AI
  and AI Gateway remain separately billable. The first trial uses search
  retrieval only and does not select a generation model.
- Wrangler supports OAuth scope selection and opt-in OS keychain storage with
  `wrangler login --use-keyring`. This is relevant only to the advanced local
  BYO-account mode; the website must not request Cloudflare account access.

## Sources

- https://developers.cloudflare.com/ai-search/get-started/workers/
- https://developers.cloudflare.com/ai-search/how-to/connect-mcp-client/
- https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/
- https://developers.cloudflare.com/ai-search/platform/limits-pricing/
- https://developers.cloudflare.com/ai-search/wrangler-commands/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/commands/general/

## Unverified Before A Live Run

- The exact privileged API used by the dashboard to enable and disable the MCP
  public endpoint is not documented in the assigned task resources.
- Namespace binding behavior through a deployed generated Worker has not been
  live-tested in Docs Trials.
- Cleanup races and immediate absence after instance and namespace deletion
  remain untested.
