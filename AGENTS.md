# Docs Trials Agent Guide

## Mission

Build an open-source platform that determines whether a coding agent can successfully use developer documentation to ship a working integration. The platform must produce reproducible, evidence-backed findings rather than subjective documentation scores.

## Fixed Decisions

- Repository name: `docs-trials`.
- License: Apache-2.0.
- Initial product: reproducible documentation trials, starting with a curated
  baseline and expanding to user-authored drafts.
- Initial showcase: RealtimeKit two-participant React video room.
- Two execution modes: a Docs Trials-controlled cloud agent for comparable
  runs, and an agent-neutral local runner for a user's existing coding agent.
- Primary outcome: deterministic verification of a working application.
- Artifact format: each completed trial emits a portable `AX.md` report plus machine-readable evidence.
- Infrastructure direction: Cloudflare Workers, Agents SDK, Workflows, Sandbox SDK, Browser Run, Artifacts, AI Gateway, Kumo, and Tailwind CSS v4.
- Anonymous users can create and run local trials only. Their inputs and
  reports remain in their workspace unless they explicitly opt into a future
  cloud-backed run.

## Product Rules

- Test the documentation and developer resources, not an LLM's ability to guess from prior knowledge.
- The coding agent may access only the resources assigned to that trial variant.
- Do not preload an entire documentation corpus into the agent context.
- Prefer deterministic graders. An analysis model may explain results, but may not decide pass/fail alone.
- Capture the evidence chain: source revision, resources exposed, prompts, agent actions, generated source, command output, browser evidence, and grader results.
- Never expose persistent customer credentials to generated client code or trial artifacts.
- A user defines the task to test. Workers AI may suggest a task and
  verification profile from submitted docs, but the user must approve the
  frozen manifest before execution.
- Reports distinguish deterministic verification from advisory AI diagnosis.
  The diagnostic must cite redacted evidence, state confidence, and never
  change the pass/fail result.
- Keep the first self-serve verification profile narrow: web applications with
  browser-visible acceptance criteria. CLI, server, and connected-integration
  profiles follow after the end-to-end local path works.

## Source Of Truth

- Product intent: [`docs/PRODUCT.md`](docs/PRODUCT.md)
- MVP task and graders: [`docs/MVP.md`](docs/MVP.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- UX: [`docs/UX.md`](docs/UX.md)
- Build order: [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- Assumptions and references: [`research/`](research/README.md)
- Decisions: [`docs/decisions/`](docs/decisions/)

When implementation changes a fixed decision, add an ADR instead of silently changing behavior.

## Engineering Conventions

- Use TypeScript with strict type checking.
- Use `pnpm` for package management.
- Use a workspace only when more than one deployable package is actually needed.
- Keep schemas close to the domain and validate data crossing process or network boundaries.
- Treat logs and recordings as sensitive evidence; redact tokens, room secrets, authorization headers, and personally identifying test data before persistence.
- Prefer small, vertically complete changes over framework-first abstractions.
- Document external API assumptions with a source URL and retrieval date in `research/`.
- Retrieve current Cloudflare product APIs before implementation. Product APIs and availability may change.

## Critical Thinking

**You are not a code monkey. You are expected to think about design and UX.**

- Question whether the current component structure is right before adding to it.
- If a directory has more than 10-12 files, consider whether subdirectories are needed.
- If you find yourself duplicating logic across components, stop and extract a shared hook or component.
- If a name feels wrong, it probably is. Raise it before committing.
- When asked to do something, check whether it conflicts with existing conventions.
- Say "I don't know" when uncertain rather than guessing.
- If multiple interpretations exist, present them rather than picking one.

## Structural Awareness

**Before creating new files, check context:**

1. Inspect the target directory to see what is already there.
2. Check whether a similar component, hook, or pattern already exists.
3. Read `.claude/conventions.md` for naming and placement rules when that file exists.
4. If you are about to create the 10th or later file in a flat directory, propose reorganization first.

## Intended Validation

Commands will be defined after scaffolding. The baseline expectation is:

```txt
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

For a trial path, add a deterministic integration command that reports a machine-readable result before considering the feature complete.
