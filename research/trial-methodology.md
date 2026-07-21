# Trial Methodology

## What A Trial Measures

A trial measures whether a particular controlled coding agent, operating under a frozen configuration, can complete a specific task with a defined set of developer resources.

It does not measure universal documentation quality or all agents' capabilities.

## Valid Comparison Rules

To compare two variants, hold constant:

- task and acceptance criteria;
- starter repository revision;
- model and agent configuration;
- sandbox runtime and dependencies;
- credentials and test environment;
- grader implementation;
- time, token, and retry budgets.

Change one variable deliberately, such as the addition of a skill or blueprint.

## Repeatability

Agent behavior is stochastic. A single run is a diagnostic artifact, not a robust benchmark. Comparison reports must show:

- number of runs;
- individual outcomes;
- frozen configurations;
- terminal failure reasons;
- aggregate results only when enough repeat runs exist.

## Evidence Hierarchy

1. Executable grader result and captured runtime evidence.
2. Browser recording, screenshots, console, and network summary.
3. Build and command output.
4. Generated source and diff.
5. Agent action trace and resource access history.
6. Analysis-agent explanation.

Lower-ranked evidence cannot override higher-ranked evidence.

## Finding Attribution

A report should say "the agent failed after reading X and attempting Y" rather than asserting that a documentation page caused the failure unless the evidence supports that attribution. Findings are hypotheses with linked evidence, not claims of certainty.

## Security And Privacy

- Use synthetic identities and isolated test rooms.
- Redact secrets before durable persistence.
- Minimize recording retention.
- Do not place customer source or credentials into a public benchmark by default.
- Clearly distinguish product telemetry from generated application telemetry.
