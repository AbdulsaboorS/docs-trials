# Docs Trials

Docs Trials observes whether a coding agent can turn supplied documentation
into a mechanically healthy web integration. It separates observed facts from
claims about task completion or documentation quality.

## Language

**Operator**:
The person or team that defines and runs a trial.
_Avoid_: User, tester

**Subject Agent**:
The external coding agent whose work the trial observes.
_Avoid_: Operator agent, grader, model

**Trial**:
A frozen task, documentation input, application configuration, and applicable
check set.
_Avoid_: Test, benchmark, run

**Attempt**:
One immutable verification of a prepared trial.
_Avoid_: Retry, rerun, run

**Author Goal**:
A desired task behavior recorded for context but not graded by the baseline.
_Avoid_: Criterion, requirement, check

**Observation**:
A raw fact collected from a command, process, browser, network request, or file.
_Avoid_: Finding, result

**Check**:
A package-owned deterministic rule that evaluates specified observations.
_Avoid_: Goal, model judgment

**Check Result**:
A `passed`, `failed`, or `inconclusive` outcome produced by one check.
_Avoid_: Score, recommendation

**Baseline**:
The applicable generic checks for mechanical web-application health.
_Avoid_: Task verification, benchmark

**Evidence**:
Retained data that lets a reader reproduce or inspect an observation.
_Avoid_: Proof of causality

**Documentation Finding**:
A claim about documentation supported by trial evidence and explicit analysis.
_Avoid_: Run failure, check failure

**Recommendation**:
An advisory, evidence-linked documentation change that cannot alter results.
_Avoid_: Fix, verdict, check

**Documentation Snapshot**:
The retrieved content, source URL, time, content type, and digest frozen for a
trial.
_Avoid_: Live docs, URL reference

**Operator Skill**:
Optional instructions that help an operator's agent use Docs Trials. The
subject agent must not receive it.
_Avoid_: CLI, subject skill
