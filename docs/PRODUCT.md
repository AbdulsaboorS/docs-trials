# Product: Docs Trials

## Problem

Developer documentation can be accurate and still fail the practical question a developer or coding agent has: can I use this material to build, debug, and verify a working product?

Existing documentation assessments often measure structural properties such as Markdown availability, `llms.txt`, content coverage, or model opinions. Those signals are useful but insufficient. They do not show whether an agent can complete an integration while respecting authentication, supported packages, runtime constraints, and real browser behavior.

## Product Definition

Docs Trials gives a controlled coding agent a real developer task and only the documentation resources selected for the trial. The platform runs the generated application in an isolated environment, validates it with deterministic checks and browser automation, and produces an evidence-backed report.

The central unit is a **trial**:

```txt
Task + resource variant + starter repository + environment + graders = trial
```

## Core Value

- Establish whether an agent can actually ship with a product's docs.
- Locate the documentation step that caused a failure.
- Compare resource variants fairly: website docs, Markdown, MCP, skill, API schema, or blueprint.
- Prove whether a docs improvement changes outcomes by rerunning the same trial.

## Non-Goals For The First Release

- Ranking all developer products publicly.
- Supporting every agent, editor, framework, or language.
- Replacing a product's own test suite.
- Judging documentation style without a task outcome.
- Letting an unconstrained agent browse the internet and call the result a documentation test.
- Automatically merging generated docs patches.

## Users

### Documentation and developer-relations teams

They need to identify the highest-impact barriers to agent-assisted integration and prove that changes help.

### Product engineers

They need executable evidence that a documented onboarding path is viable and secure.

### SDK and platform teams

They need to compare the practical value of docs, examples, blueprints, skills, and MCP servers.

## Trial Classes

- **Discovery:** Can the agent identify the correct product and entry point?
- **Integration:** Can it produce a working first implementation?
- **Adaptation:** Can it adapt a supported example to a nearby use case?
- **Debugging:** Can it diagnose and repair a broken integration?
- **Production:** Can it meet predefined security, lifecycle, and reliability requirements?

The MVP implements integration only.

## Success Metrics

The first product metric is trial completion quality, not page views:

- deterministic pass rate across repeated runs;
- time to verified result;
- number and type of failed attempts;
- number of human interventions;
- resource accesses preceding an error;
- improvement in pass rate after a docs-resource change.

## First Design Partner Scenario

RealtimeKit is the initial showcase because real-time video exposes the exact issues Docs Trials is designed to surface: package selection, authentication boundaries, browser permissions, multi-participant state, lifecycle handling, and end-to-end verification.
