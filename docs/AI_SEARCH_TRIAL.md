# AI Search Internal Knowledge Trial

## Purpose

This is the first connected-integration dogfood trial. It tests whether a coding
agent can use the assigned AI Search documentation to create a built-in-storage
instance, index a supplied synthetic knowledge corpus, and expose the corpus to
an AI agent through the built-in MCP endpoint.

The trial may fail. In particular, the current documentation describes MCP
public-endpoint enablement as a dashboard action. Docs Trials must preserve that
constraint rather than add an undocumented human intervention or silently
narrow the task.

## User Input

The intended authoring experience asks for only:

- documentation: `https://developers.cloudflare.com/ai-search/`;
- goal: create and index an internal knowledge base for agent research.

Docs Trials supplies the starter, synthetic corpus, resource names, limits, and
draft deterministic checks. The user approves the frozen contract before a run.

## Frozen Task

Using only the assigned AI Search documentation and starter workspace:

1. configure a run-scoped AI Search namespace binding;
2. create exactly one built-in-storage instance;
3. upload and await indexing for all three supplied Markdown files;
4. expose the instance's built-in MCP search tool; and
5. make the supplied research question return the run-specific fact and source.

The generated application never receives a Cloudflare account token. A trusted
harness supplies only the run namespace binding during privileged execution.

## Assigned Documentation

- `https://developers.cloudflare.com/ai-search/get-started/workers/`
- `https://developers.cloudflare.com/ai-search/api/items/workers-binding/`
- `https://developers.cloudflare.com/ai-search/how-to/connect-mcp-client/`

The agent may follow links within these assigned resources only when the frozen
resource policy records the retrieval. Do not preload the complete AI Search
documentation corpus.

## Deterministic Checks

1. The generated Worker installs and builds.
2. Exactly the run-scoped instance exists in the isolated namespace.
3. All three expected document keys reach an indexed state.
4. The public MCP endpoint is enabled and lists the search tool.
5. An MCP search returns the run-specific fact and its source document.
6. No credential-shaped value appears in generated source or retained evidence.
7. The Worker, AI Search instance, and namespace are deleted and confirmed
   absent after the run.

An observed application or integration mismatch is `failed`. Missing provider
or verifier evidence is `inconclusive`. Cleanup failure is also inconclusive and
must prevent admission release; it is not attributed to the documentation.

## Private Run Envelope

- one run-specific AI Search namespace;
- one built-in-storage instance;
- three synthetic Markdown files, each below 4 KiB;
- at most ten search or MCP requests;
- no website crawl, R2 source, image conversion, AI Gateway, or separate
  generation model;
- a fifteen-minute absolute resource lifetime;
- synthetic content only on the unauthenticated public MCP endpoint; and
- instance, namespace, and Worker absence verified during cleanup.

AI Search is free during its current open beta within plan limits. Workers AI
and AI Gateway can still be billed separately, so this trial does not use them.
Exact pricing and limits must be retrieved again before a live run.

## Live Status

No AI Search resource is created by the checked-in preparation command. The
first credentialed run requires a reviewed adapter, an approved exact budget,
an Access-protected internal route, and the cleanup checks above. Public hosted
execution remains disabled.

The non-live contract can be exercised with:

```sh
pnpm trial:ai-search:prepare -- ais-contract-001
pnpm trial:ai-search:preflight -- trial-output/ais-contract-001
```

The preparation command retrieves the three assigned Markdown pages, stores
them in the workspace, and binds their SHA-256 digests into the contract. The
preflight command generates only canonical unavailable observations and
therefore cannot emit a passing live-integration report. Provider-derived
evidence must be collected directly by the future trusted adapter and bound to
the externally admitted contract digest and resource IDs. The local digest
detects accidental mutation but is not a signature or authenticity boundary.
