# UX

## Product Character

Docs Trials should feel like a forensic engineering workbench, not a generic AI dashboard. The interface connects what the agent read, what it changed, what ran, and what the browser proved.

## MVP Screens

### Trial Catalog

The initial screen lists curated trials. The RealtimeKit video-room trial is the only active entry in the first build.

Show:

- task objective;
- resource variant;
- frozen source revision;
- last result;
- start action.

### Run Setup

Before a run, display the immutable task contract and resource manifest. The user can provide required test credentials through a secret form, never through a persisted task file.

The primary action is explicit:

```txt
Run baseline trial
```

### Live Trial

Use a three-pane workbench on desktop:

- **Resources:** documentation URLs, retrievals, and tool calls;
- **Workspace:** agent intent, changed files, commands, builds, and errors;
- **Verification:** current workflow phase and Browser Run evidence.

On narrow screens, the same panels become a chronological timeline with a selected detail drawer. Do not try to render a three-pane IDE on mobile.

Each event shows a stable timestamp, phase, status, and evidence link. Agent thought text is not required; show tool intent and observable actions instead.

### Report

Lead with the result, then the evidence:

```txt
Result: Failed
Passed: 6 of 10 criteria
Time to terminal result: 12m 41s
```

The result may also be **Inconclusive** when deterministic evidence is missing
or a platform interruption prevents verification. The report must describe the
unresolved check without presenting it as a documentation failure.

Follow with:

- criterion-by-criterion results;
- annotated agent and resource timeline;
- browser screenshots and recording link;
- documentation friction findings linked to evidence;
- suggested remediation, clearly labeled as advisory;
- a downloadable `AX.md`.

## Comparison View

Comparison is a post-MVP capability but the data model must support it. It compares matching task specifications with a single deliberate variable changed, such as docs-only versus docs-plus-skill.

Do not call a comparison causal when the task, model, runtime, or resource revision also changed.

## Accessibility

- Preserve a text-first timeline and report independent of recordings or screenshots.
- Provide accessible names and states for run phases and criterion results.
- Do not communicate pass/fail through color alone.
- Treat the AX report as a first-class accessible artifact.
