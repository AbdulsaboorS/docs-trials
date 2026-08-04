import { Button } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseResultForRun, type Result } from "./result-schema";
import {
  resultMatchesRunPath,
  runIdFromPath,
  sampleSyntheticRunId,
  unsupportedCustomRunId,
} from "./run-route";
import "./styles.css";

type Trial = { id: string; title: string; task: string; acceptanceCriteria: string[] };
type Draft = {
  title: string;
  task: string;
  starter: "template" | "repository";
  repository: string;
  sources: string;
  verification: "browser";
};

const initialDraft: Draft = {
  title: "",
  task: "",
  starter: "template",
  repository: "",
  sources: "",
  verification: "browser",
};

const architecture = [
  [
    "Think",
    "Constrained coding agent",
    "Reads only the approved documentation and records observable tool actions.",
  ],
  [
    "Sandbox",
    "Isolated build workspace",
    "Installs dependencies, builds untrusted generated code, and exposes a preview.",
  ],
  [
    "Browser Run",
    "Deterministic browser proof",
    "Uses isolated browser contexts to verify the running application, not the agent's claims.",
  ],
  [
    "Artifacts",
    "Versioned evidence package",
    "Preserves redacted source, logs, browser evidence, and the portable report for cloud runs.",
  ],
  [
    "Workers AI",
    "Advisory diagnosis",
    "Explains evidence-backed documentation friction but can never change the deterministic result.",
  ],
  [
    "Workflows",
    "Durable orchestration",
    "Tracks retries, timeouts, cancellation, and every phase transition of a cloud run.",
  ],
] as const;

const phaseOrder = ["prepare", "execute", "build", "preview", "verify", "report"] as const;
const phaseLabels = {
  prepare: "Freeze manifest and prepare workspace",
  execute: "Controlled agent edits source",
  build: "Install dependencies and build",
  preview: "Start isolated preview",
  verify: "Run deterministic browser checks",
  report: "Assemble redacted evidence and AX.md",
} as const;

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [trial, setTrial] = useState<Trial>();
  const [result, setResult] = useState<Result>();
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const requestedRunId = runIdFromPath(path);
  const currentResultRunId = result?.run.id;

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!path.startsWith("/runs/") && !path.startsWith("/reports/")) {
      setResultLoading(false);
      setResultError(undefined);
      return;
    }
    const runId = requestedRunId;
    if (!runId) {
      setResultLoading(false);
      setResultError("This run URL is invalid.");
      return;
    }
    if (currentResultRunId === runId) {
      setResultLoading(false);
      setResultError(undefined);
      return;
    }
    if (runId === unsupportedCustomRunId) {
      setResultLoading(false);
      setResultError(
        "Custom drafts do not execute in the browser yet. Use the agent-neutral CLI runner from a clean local workspace.",
      );
      return;
    }

    const controller = new AbortController();
    setResultLoading(true);
    setResultError(undefined);
    void fetch(`/api/local-runs/${encodeURIComponent(runId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("This synthetic run package is unavailable.");
        setResult(parseResultForRun(await response.json(), runId));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setResultError(cause instanceof Error ? cause.message : "The run package could not load.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setResultLoading(false);
      });
    return () => controller.abort();
  }, [path, requestedRunId, currentResultRunId]);

  function navigate(nextPath: string) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function navigateHomeSection(id: string) {
    navigate("/");
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  async function loadTrial() {
    setError(undefined);
    try {
      const response = await fetch("/api/trials/realtimekit-video-room-v1");
      if (!response.ok) throw new Error("Unable to load the curated trial.");
      setTrial((await response.json()) as Trial);
      navigate("/trials/realtimekit-video-room-v1/review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The trial could not load.");
    }
  }

  async function runLocalTrial() {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/trials/realtimekit-video-room-v1/local", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Unable to generate the synthetic report preview.");
      const packageResult = parseResultForRun(await response.json());
      setResult(packageResult);
      navigate(`/runs/${packageResult.run.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The trial could not start.");
    } finally {
      setLoading(false);
    }
  }

  const routedResult = resultMatchesRunPath(path, result?.run.id) ? result : undefined;
  const page = path.startsWith("/trials/new") ? (
    <Builder draft={draft} setDraft={setDraft} navigate={navigate} />
  ) : path.startsWith("/trials/realtimekit-video-room-v1/review") ? (
    <Review trial={trial} navigate={navigate} runLocalTrial={runLocalTrial} loading={loading} />
  ) : path.startsWith("/trials/custom/review") ? (
    <ReviewDraft draft={draft} navigate={navigate} />
  ) : path.startsWith("/runs/") ? (
    <RunScreen
      result={routedResult}
      loading={resultLoading}
      loadError={resultError}
      navigate={navigate}
    />
  ) : path.startsWith("/reports/") ? (
    <Report
      result={routedResult}
      loading={resultLoading}
      loadError={resultError}
      navigate={navigate}
    />
  ) : (
    <Home navigate={navigate} loadTrial={loadTrial} />
  );

  return (
    <main>
      <Header navigate={navigate} navigateHomeSection={navigateHomeSection} />
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {page}
    </main>
  );
}

function Header({
  navigate,
  navigateHomeSection,
}: {
  navigate: (path: string) => void;
  navigateHomeSection: (id: string) => void;
}) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={() => navigate("/")}>
        <span className="wordmark-mark">DT</span>Docs Trials
      </button>
      <nav aria-label="Primary navigation">
        <button onClick={() => navigateHomeSection("how-it-works")}>How it works</button>
        <button onClick={() => navigate("/trials/realtimekit-video-room-v1/review")}>
          Sample trial
        </button>
        <button onClick={() => navigate("/trials/new")}>New trial</button>
      </nav>
      <span className="header-status">LOCAL-FIRST MVP</span>
    </header>
  );
}

function Home({
  navigate,
  loadTrial,
}: {
  navigate: (path: string) => void;
  loadTrial: () => void;
}) {
  return (
    <>
      <section className="hero" id="top">
        <div>
          <p className="eyebrow">DOCUMENTATION, UNDER LOAD</p>
          <h1>Can an agent actually ship from these docs?</h1>
          <p className="hero-copy">
            Docs Trials turns a documented developer promise into a frozen task, observable agent
            work, deterministic verification, and a report your documentation team can act on.
          </p>
          <div className="hero-actions" aria-label="Start a Docs Trials workflow">
            <button
              className="hero-action hero-action-primary"
              onClick={() => navigate("/trials/new")}
            >
              <span>Test your documentation</span>
              <small>Paste docs, define a task, run locally.</small>
            </button>
            <button className="hero-action" onClick={loadTrial}>
              <span>See a real example</span>
              <small>Inspect the sample trial and its evidence report.</small>
            </button>
          </div>
          <p className="hero-fine-print">
            <strong>Private by default.</strong> Run locally in your own workspace. Cloud execution
            is an optional future mode.
          </p>
        </div>
        <aside className="signal-panel" aria-label="How Docs Trials works">
          <p className="eyebrow">EVIDENCE CHAIN</p>
          <ol>
            <li>
              <span>01</span> Freeze a developer claim
            </li>
            <li>
              <span>02</span> Observe implementation work
            </li>
            <li>
              <span>03</span> Verify the running result
            </li>
            <li>
              <span>04</span> Explain friction with proof
            </li>
          </ol>
          <p className="signal-note">
            No opaque quality score. Every conclusion links to observable evidence.
          </p>
        </aside>
      </section>

      <section className="section" aria-labelledby="sample-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">START HERE</p>
            <h2 id="sample-title">A known trial, end to end.</h2>
          </div>
          <span className="count-label">01 CURATED SAMPLE</span>
        </div>
        <article className="trial-card">
          <div className="trial-card-topline">
            <span className="status-dot" aria-hidden="true" />
            <span>ILLUSTRATIVE REPORT SHAPE</span>
            <span className="trial-id">realtimekit-video-room-v1</span>
          </div>
          <div className="trial-card-body">
            <div>
              <h3>RealtimeKit two-participant video room</h3>
              <p>
                Build and verify a React room where two participants join, publish media, leave, and
                rejoin. It demonstrates the report standard, not a requirement for your own trial.
              </p>
            </div>
            <dl>
              <div>
                <dt>Variant</dt>
                <dd>Docs only</dd>
              </div>
              <div>
                <dt>Verifier</dt>
                <dd>Synthetic sample</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>AX.md + evidence</dd>
              </div>
            </dl>
          </div>
          <div className="trial-actions">
            <Button variant="secondary" onClick={loadTrial}>
              Inspect contract
            </Button>
            <Button onClick={() => navigate(`/reports/${sampleSyntheticRunId}`)}>
              View sample report
            </Button>
          </div>
        </article>
      </section>

      <Architecture />

      <section className="section report-excerpt" aria-labelledby="report-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">REPORT STANDARD</p>
            <h2 id="report-title">Evidence before conclusions.</h2>
          </div>
          <Button variant="secondary" onClick={() => navigate(`/reports/${sampleSyntheticRunId}`)}>
            Open report
          </Button>
        </div>
        <div className="excerpt-grid">
          <div>
            <p className="panel-label">SAMPLE OUTCOME</p>
            <strong>Illustrative pass</strong>
            <p>
              This report preview demonstrates separate build, preview, browser, and redaction rows.
              It is not evidence that the RealtimeKit task ran.
            </p>
          </div>
          <div>
            <p className="panel-label">ACTIONABLE DIAGNOSIS</p>
            <strong>Recommendations cite proof</strong>
            <p>
              When a run fails, Docs Trials distinguishes documentation friction from missing setup,
              external dependencies, agent mistakes, and inconclusive evidence.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function Architecture() {
  return (
    <section
      className="section architecture"
      id="how-it-works"
      aria-labelledby="architecture-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">BUILT ON CLOUDFLARE</p>
          <h2 id="architecture-title">A chain of custody for every run.</h2>
        </div>
        <span className="count-label">EACH STAGE EXPLAINS ITS ROLE</span>
      </div>
      <div className="architecture-flow" aria-label="Docs Trials architecture flow">
        Documentation <span>→</span> Think <span>→</span> Sandbox <span>→</span> Browser Run{" "}
        <span>→</span> Artifacts <span>→</span> Report
      </div>
      <div className="architecture-grid">
        {architecture.map(([name, role, description], index) => (
          <article key={name} className="architecture-card" tabIndex={0}>
            <div className="architecture-card-heading">
              <span className="architecture-index">0{index + 1}</span>
              <span>
                <strong>{name}</strong>
                <small>{role}</small>
              </span>
            </div>
            <p>{description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Builder({
  draft,
  setDraft,
  navigate,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  navigate: (path: string) => void;
}) {
  const [suggestion, setSuggestion] = useState(false);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const valid = Boolean(draft.title.trim() && draft.task.trim() && draft.sources.trim());
  return (
    <section className="route-section builder-route">
      <RouteTrail navigate={navigate} current="Create trial" />
      <p className="eyebrow">NEW PRIVATE TRIAL / 01 INPUTS</p>
      <h1>Define the developer promise to test.</h1>
      <p className="route-intro">
        State what the supplied docs claim a developer can build. Docs Trials will evaluate that
        claim, not invent one after a failure.
      </p>
      <div className="builder-layout">
        <form
          className="draft-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) navigate("/trials/custom/review");
          }}
        >
          <label>
            Trial title
            <input
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="OAuth quickstart reliability"
            />
          </label>
          <label>
            Required task
            <textarea
              value={draft.task}
              onChange={(event) => update("task", event.target.value)}
              placeholder="Using these docs, build a React app that signs in with OAuth."
              rows={4}
            />
          </label>
          <button type="button" className="suggestion-button" onClick={() => setSuggestion(true)}>
            Suggest a task from my docs <span>Planned Workers AI helper</span>
          </button>
          {suggestion ? (
            <div className="suggestion-preview">
              <strong>Suggestion preview</strong>
              <p>
                Task suggestions will identify a likely developer journey, prerequisites, and
                browser-visible checks. You must edit and approve the result before it is frozen.
              </p>
            </div>
          ) : null}
          <fieldset>
            <legend>Starting point</legend>
            <label className="choice">
              <input
                type="radio"
                checked={draft.starter === "template"}
                onChange={() => update("starter", "template")}
              />{" "}
              Docs Trials web-app template
            </label>
            <label className="choice">
              <input
                type="radio"
                checked={draft.starter === "repository"}
                onChange={() => update("starter", "repository")}
              />{" "}
              Existing repository URL
            </label>
            {draft.starter === "repository" ? (
              <input
                value={draft.repository}
                onChange={(event) => update("repository", event.target.value)}
                placeholder="https://github.com/you/starter"
                aria-label="Starter repository URL"
              />
            ) : null}
          </fieldset>
          <label>
            Documentation sources
            <textarea
              value={draft.sources}
              onChange={(event) => update("sources", event.target.value)}
              placeholder="Paste Markdown, one public documentation URL per line, or both."
              rows={7}
            />
          </label>
          <fieldset>
            <legend>Verification profile</legend>
            <label className="choice">
              <input type="radio" checked readOnly /> Web application: build, preview, and
              browser-visible acceptance checks
            </label>
            <p className="field-note">
              CLI, server, and connected-service verification profiles are planned after the web
              path.
            </p>
          </fieldset>
          <Button type="submit" disabled={!valid}>
            Review frozen manifest
          </Button>
        </form>
        <aside className="draft-notes">
          <p className="eyebrow">WRITING A GOOD TASK</p>
          <h3>Describe a verifiable outcome.</h3>
          <ul>
            <li>Name the application or integration to build.</li>
            <li>Name the user-visible behavior that proves it works.</li>
            <li>Keep the first task narrow enough for one run.</li>
            <li>Do not paste secrets into docs or task text.</li>
          </ul>
          <p className="draft-fine-print">
            Your draft is held only in page memory. Refreshing or closing this tab discards it; it
            is not submitted or stored.
          </p>
        </aside>
      </div>
    </section>
  );
}

function Review({
  trial,
  navigate,
  runLocalTrial,
  loading,
}: {
  trial: Trial | undefined;
  navigate: (path: string) => void;
  runLocalTrial: () => void;
  loading: boolean;
}) {
  const current = trial ?? {
    id: "realtimekit-video-room-v1",
    title: "RealtimeKit two-participant React video room",
    task: "Using only the supplied RealtimeKit documentation and starter repository, build a React application that allows two browser participants to join, publish media, leave, and rejoin.",
    acceptanceCriteria: [
      "Application installs and builds",
      "Preview is reachable",
      "Two participants can join",
      "Participants can leave and rejoin",
    ],
  };
  return (
    <Manifest
      title={current.title}
      task={current.task}
      criteria={current.acceptanceCriteria}
      criteriaSource="Provided by the curated RealtimeKit template"
      navigate={navigate}
      primaryLabel="Generate synthetic report preview"
      primaryAction={runLocalTrial}
      loading={loading}
    />
  );
}

function ReviewDraft({ draft, navigate }: { draft: Draft; navigate: (path: string) => void }) {
  return (
    <Manifest
      title={draft.title || "Untitled private trial"}
      task={
        draft.task || "No task provided. Return to the builder to define the developer promise."
      }
      criteria={[
        "Application installs and builds",
        "Preview starts and can be opened in a browser",
        "The documented user flow has browser-visible checks",
      ]}
      criteriaSource="Draft checks for the future local-runner connection"
      navigate={navigate}
      primaryLabel="Local runner connection coming next"
      primaryAction={() => undefined}
      showPrimaryAction={false}
      primaryNote="This draft is held only in page memory and is lost on refresh. Today, execution uses the agent-neutral CLI runner from a clean local workspace; the workbench is not connected to it yet."
      sealLabel="BROWSER-ONLY DRAFT"
      sidebarTitle="Drafted locally, not executed."
      sidebarDescription="This draft remains only in page memory and is lost on refresh. It does not create artifacts, invoke an agent, or start the CLI runner."
      heading="Review this browser-only draft."
      runExplanation="The workbench does not execute this draft or collect evidence yet. Use the agent-neutral CLI runner separately from a clean local workspace."
      eyebrow="DRAFT REVIEW / 02 CHECK"
    />
  );
}

function Manifest({
  title,
  task,
  criteria,
  criteriaSource,
  requireCriteriaApproval = false,
  navigate,
  primaryLabel,
  primaryAction,
  primaryDisabled = false,
  primaryNote,
  showPrimaryAction = true,
  sealLabel = "PENDING FREEZE",
  sidebarTitle = "Local by default.",
  sidebarDescription = "The first self-serve path opens a local report viewer and writes downloadable redacted artifacts. It does not upload your source or pasted docs.",
  heading = "Review the task before your agent starts.",
  runExplanation = "Your coding agent works in your workspace. Docs Trials collects redacted evidence and checks the result.",
  eyebrow = "MANIFEST REVIEW / 02 FREEZE",
  loading,
}: {
  title: string;
  task: string;
  criteria: string[];
  criteriaSource: string;
  requireCriteriaApproval?: boolean;
  navigate: (path: string) => void;
  primaryLabel: string;
  primaryAction: () => void;
  primaryDisabled?: boolean;
  primaryNote?: string;
  showPrimaryAction?: boolean;
  sealLabel?: string;
  sidebarTitle?: string;
  sidebarDescription?: string;
  heading?: string;
  runExplanation?: string;
  eyebrow?: string;
  loading?: boolean;
}) {
  const [criteriaApproved, setCriteriaApproved] = useState(!requireCriteriaApproval);
  return (
    <section className="route-section">
      <RouteTrail navigate={navigate} current="Review trial" />
      <p className="eyebrow">{eyebrow}</p>
      <h1>{heading}</h1>
      <div className="manifest-layout">
        <article className="contract-panel">
          <div className="contract-heading">
            <div>
              <p className="eyebrow">TRIAL CONTRACT</p>
              <h3>{title}</h3>
            </div>
            <span className="seal">{sealLabel}</span>
          </div>
          <p>{task}</p>
          <div className="contract-grid contract-grid-plain">
            <div className="contract-section">
              <h4>How success is checked</h4>
              <p className="criteria-source">{criteriaSource}</p>
              <ol>
                {criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ol>
              {requireCriteriaApproval ? (
                <label className="approval-check">
                  <input
                    type="checkbox"
                    checked={criteriaApproved}
                    onChange={(event) => setCriteriaApproved(event.target.checked)}
                  />
                  I reviewed these suggested checks and want to use them for this trial.
                </label>
              ) : null}
            </div>
            <div className="contract-section">
              <h4>What your agent can use</h4>
              <p>
                Only the docs and starting code shown in this trial. Never add passwords, API keys,
                or other secrets.
              </p>
              <h4>How this run works</h4>
              <p>{runExplanation}</p>
            </div>
          </div>
        </article>
        <aside className="review-sidebar">
          <p className="eyebrow">RUN PRIVACY</p>
          <h3>{sidebarTitle}</h3>
          <p>{sidebarDescription}</p>
          {showPrimaryAction ? (
            <Button
              loading={loading ?? false}
              disabled={primaryDisabled || !criteriaApproved}
              onClick={primaryAction}
            >
              {primaryLabel}
            </Button>
          ) : null}
          {primaryNote ? <p className="approval-note">{primaryNote}</p> : null}
          {requireCriteriaApproval && !criteriaApproved ? (
            <p className="approval-note">
              Approve the suggested checks to continue. You can refine them in a future editing
              step.
            </p>
          ) : null}
          <Button variant="secondary" onClick={() => navigate("/trials/new")}>
            Edit inputs
          </Button>
        </aside>
      </div>
    </section>
  );
}

function RunScreen({
  result,
  loading,
  loadError,
  navigate,
}: {
  result: Result | undefined;
  loading: boolean;
  loadError: string | undefined;
  navigate: (path: string) => void;
}) {
  const events = result?.run.events ?? [];
  const [visibleCount, setVisibleCount] = useState(events.length > 0 ? 1 : 0);

  useEffect(() => {
    setVisibleCount(events.length > 0 ? 1 : 0);
    if (events.length < 2) return;
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        if (current >= events.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 450);
    return () => window.clearInterval(timer);
  }, [events]);

  if (!result) {
    return (
      <UnavailableRun current="Run trial" loading={loading} error={loadError} navigate={navigate} />
    );
  }

  const visibleEvents = events.slice(0, visibleCount);
  const replayComplete = events.length > 0 && visibleCount >= events.length;
  const currentMessage = visibleEvents.at(-1)?.message ?? "Waiting for a synthetic run package.";
  return (
    <section className="route-section">
      <RouteTrail navigate={navigate} current="Run trial" />
      <p className="eyebrow">SIMULATED CONTROLLED CLOUD REPLAY / 03 OBSERVE</p>
      <h1>Every expensive or long-running action stays visible.</h1>
      <p className="route-intro">
        This replay uses the canonical run events without starting Think, Sandbox, Browser Run, or
        Artifacts. The same states will drive a real run after cloud execution is enabled.
      </p>
      <div className="run-workbench">
        <section>
          <p className="panel-label">RUN TIMELINE / SYNTHETIC EVENT REPLAY</p>
          <p className="run-live-message" aria-live="polite">
            {currentMessage}
          </p>
          <ol className="run-timeline">
            {phaseOrder.map((phase, index) => {
              const phaseEvents = visibleEvents.filter((event) => event.phase === phase);
              const failed = phaseEvents.some((event) => event.type === "failed");
              const complete = phaseEvents.some((event) => event.type === "completed");
              const active =
                !failed && !complete && phaseEvents.some((event) => event.type === "started");
              const state = failed
                ? "failed"
                : complete
                  ? "complete"
                  : active
                    ? "active"
                    : "pending";
              const latest = phaseEvents.at(-1);
              return (
                <li key={phase} className={state}>
                  <span>{complete ? "✓" : failed ? "!" : index + 1}</span>
                  <div>
                    <strong>{phaseLabels[phase]}</strong>
                    <small>{latest?.message ?? "Waiting"}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        <aside>
          <p className="panel-label">EXECUTION CONTEXT</p>
          <dl className="context-list">
            <div>
              <dt>Mode</dt>
              <dd>Controlled cloud simulation</dd>
            </div>
            <div>
              <dt>Cloud execution</dt>
              <dd>Disabled</dd>
            </div>
            <div>
              <dt>Persistence</dt>
              <dd>Not persisted</dd>
            </div>
            <div>
              <dt>Retention target</dt>
              <dd>7 days</dd>
            </div>
          </dl>
          <p className="terminal-state-note">
            Terminal states supported: passed, failed, cancelled, and inconclusive.
          </p>
          <Button
            disabled={!result || !replayComplete}
            onClick={() => navigate(`/reports/${result?.run.id ?? "local-realtimekit-sample"}`)}
          >
            {replayComplete ? "View assembled report" : "Replay in progress"}
          </Button>
        </aside>
      </div>
    </section>
  );
}

function Report({
  result,
  loading,
  loadError,
  navigate,
}: {
  result: Result | undefined;
  loading: boolean;
  loadError: string | undefined;
  navigate: (path: string) => void;
}) {
  if (!result) {
    return (
      <UnavailableRun current="Report" loading={loading} error={loadError} navigate={navigate} />
    );
  }
  const report = result.report.markdown;
  const outcome = result.report.outcome;
  const events = result.run.events.map((event) => event.message);
  return (
    <section className="route-section">
      <RouteTrail navigate={navigate} current="Report" />
      <p className="eyebrow">PRIVATE REPORT / 04 EXPLAIN</p>
      <div className="report-heading">
        <div>
          <h1>
            Result: <span className={`report-outcome ${outcome}`}>{outcome}</span>
          </h1>
          <p className="route-intro">
            This synthetic sample shows the report shape only. Real reports distinguish
            deterministic results from advisory documentation recommendations.
          </p>
        </div>
        <div className="report-actions">
          <Button variant="secondary" onClick={() => navigate("/trials/new")}>
            New trial
          </Button>
          <Button disabled>
            Download AX.md <span className="button-note">Local runner</span>
          </Button>
        </div>
      </div>
      <div className="result-grid">
        <section className="timeline-panel">
          <p className="panel-label">OBSERVED TIMELINE</p>
          <ol className="timeline">
            {events.map((event, index) => (
              <li key={`${event}-${index}`}>{event}</li>
            ))}
          </ol>
        </section>
        <section className="report-panel">
          <p className="panel-label">AX.MD PREVIEW</p>
          <pre>{report}</pre>
        </section>
      </div>
      <section className="diagnostic-panel">
        <div>
          <p className="eyebrow">DIAGNOSTIC STANDARD</p>
          <h3>Recommendations explain, but do not decide.</h3>
        </div>
        <p>
          When a criterion fails, Workers AI receives redacted evidence and produces a
          confidence-labeled diagnosis. It must cite the docs consulted, failed step, and
          alternative explanations such as missing setup or an agent implementation error.
        </p>
      </section>
    </section>
  );
}

function UnavailableRun({
  current,
  loading,
  error,
  navigate,
}: {
  current: string;
  loading: boolean;
  error: string | undefined;
  navigate: (path: string) => void;
}) {
  return (
    <section className="route-section">
      <RouteTrail navigate={navigate} current={current} />
      <p className="eyebrow">LOCAL RUN PACKAGE</p>
      <div className="contract-panel">
        <h1>{loading ? "Restoring the synthetic run..." : "This run is not available."}</h1>
        <p>
          {loading
            ? "Docs Trials is reconstructing the deterministic local preview from its run ID."
            : (error ?? "No run package was supplied for this route.")}
        </p>
        {!loading ? (
          <Button onClick={() => navigate("/trials/realtimekit-video-room-v1/review")}>
            Return to sample trial
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function RouteTrail({ navigate, current }: { navigate: (path: string) => void; current: string }) {
  return (
    <nav className="route-trail" aria-label="Workflow navigation">
      <button onClick={() => navigate("/")}>Home</button>
      <span>/</span>
      <button onClick={() => navigate("/trials/new")}>Create trial</button>
      <span>/</span>
      <strong aria-current="page">{current}</strong>
    </nav>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
