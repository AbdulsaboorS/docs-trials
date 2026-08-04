# ADR 0008: Use Hosted Ephemeral Resources For Connected Trials

## Status

Accepted

## Context

Connected integration trials must exercise real provider behavior. A mock AI
Search service would not prove that an agent can follow the product
documentation, but asking a visitor to grant a new website access to their
Cloudflare account creates an unacceptable trust barrier.

The agent-neutral local runner also cannot prove that an external coding agent
is isolated from credentials already available on the user's machine. That mode
remains useful, but it cannot be the default security boundary for hosted
connected trials.

## Decision

Docs Trials will use two explicit account models:

- Supported hosted connected trials run against temporary resources owned by
  Docs Trials. The user authenticates to Docs Trials for admission and quotas,
  but never grants the website access to their provider account.
- Advanced local trials may use the user's provider account through official
  local provider tooling. The website never receives those credentials, and
  the report discloses that local credential isolation is not controlled by
  Docs Trials.

Hosted connected trials require a reviewed provider adapter. Each adapter must:

- create a run-specific isolation boundary;
- expose only the required run-scoped binding to generated code;
- keep account credentials in the trusted control plane;
- use a harness-owned deployment configuration or strictly validate and rewrite
  the generated configuration before privileged execution;
- freeze resource, request, time, and monetary limits before admission;
- use synthetic data unless a separate private-data policy is approved;
- block completion and admission release until cleanup succeeds; and
- verify that every temporary resource is absent after cleanup.

The initial AI Search trial may run privately in a dedicated namespace in the
maintainer account. It is not a public execution path and does not waive ADR
0007's controls. Public hosted execution remains disabled until those controls
and the provider adapter have passed live validation.

## Consequences

- A visitor can try a supported connected trial without trusting Docs Trials
  with their Cloudflare account.
- Hosted custom trials are limited to provider adapters with deterministic
  verification and cleanup.
- Docs Trials bears hosted resource cost and must enforce admission and abuse
  controls.
- Local BYO-account runs remain available for privacy and unsupported providers,
  but their reports disclose the weaker credential and resource boundary.
- A cleanup failure produces an inconclusive terminal result and quarantines
  the admission slot for operator action.
