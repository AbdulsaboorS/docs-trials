# Docs Trials Agent Guide

## Start Every Session

1. Read this guide, `CONTEXT.md`, `docs/PRODUCT.md`, and `SESSION_CONTEXT.md`.
2. Check Git status and recent commits before changing files.
3. Read the files named in `SESSION_CONTEXT.md`.
4. Verify current behavior and preserve unrelated changes.

## Mission And Honesty

Ship a local CLI that tests whether an AI agent can build from documentation.
Back every result with evidence that a sceptic can check.

**Never report a result that the code did not observe.**

- Results remain keyed by `CheckId` in `src/core/outcome.ts`.
- Author goals are context only. Never grade them.
- Every observation must affect a check or be marked as ungraded.
- Never imply that ungraded evidence was checked.
- State what a check observed, not what it might imply.
- A run failure needs evidence before it becomes a documentation finding.
- Make every public claim reproducible with the tool.

## Fixed Decisions

- Name: `docs-trials`. Apache-2.0. Public.
- Execution stays local for v0.
- Deterministic checks own outcomes. Models cannot change them.
- Outcomes are `passed`, `failed`, and `inconclusive`.
- Missing evidence and infrastructure trouble are `inconclusive`.
- Runs stay outside the workspace but have no same-user isolation.
- Redact evidence before writing it without changing nearby text.
- The old Workers design stays at `archive/cloud-path-v0`.
- Do not start v1 until ten real, unsteered v0 trials complete Gate 2.

## Workflow

- Plan architectural, ambiguous, or multi-step work after inspection.
- Include verification and revise the plan when evidence changes it.
- Implement small, clear changes directly.
- Use focused subagents for independent research, review, and parallel work.
- Do not delegate simple work or duplicate work between agents.
- Track substantial implementation with task tools, not new planning files.
- Report material decisions, blockers, changes, and verification.
- Find the cause of user corrections and add only durable lessons.
- Reproduce bugs when practical and fix their root cause autonomously.
- Ask one concise question only when missing information blocks safe work.

## Critical And Structural Thinking

- Question the premise and current structure before adding to them.
- Check requests against established conventions.
- Present valid interpretations instead of choosing silently.
- Say "I do not know" rather than guess.
- Raise unclear names before committing.
- Inspect the target directory and find similar code before creating files.
- Read `.claude/conventions.md` when it exists.
- Assess cohesion before adding to a flat directory with 10 to 12 files.
- Do not reorganize by file count alone or abstract incidental similarity.
- Prefer the simplest coherent solution. Do not over-engineer obvious fixes.

## Engineering Principles

- Use strict TypeScript, `pnpm`, and Node 22 or later.
- Validate process, network, and file boundaries with Zod.
- Change only what current requirements need.
- Do not preserve compatibility without a concrete requirement.
- Remove obsolete paths instead of adding fallback layers.
- Grow through working end-to-end layers.
- Keep responsibilities clear and modules cohesive.
- Check current dependencies, docs, and types before adding code or packages.
- Prefer maintained libraries when they reduce total complexity or risk.
- Avoid known dead ends without designing for hypothetical work.
- Run working code before writing more than one day of changes.
- Cleanup must never discard a completed run.

## Text, Verification, And Handoff

- Use concise labels. Add supporting text only to prevent misunderstanding.
- Comments explain lasting decisions, constraints, or non-obvious behavior.
- Use Simplified Technical English principles in user-facing text.
- Do not claim strict ASD-STE100 compliance without its approved word list.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- For check changes, run a real trial and read the generated report.
- Update `SESSION_CONTEXT.md` after substantial work; replace its contents.
- Keep only the last summary, next work, blockers, and required files there.
- `AGENTS.md` must never exceed 90 lines.
- `SESSION_CONTEXT.md` must never exceed 50 lines.
- Keep detailed research and exploit reports outside the public repository.
