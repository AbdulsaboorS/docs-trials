import { describe, expect, it } from "vitest";
import { validateAccessClaims } from "../src/access-auth";
import {
  ArtifactsUnavailableError,
  UnavailableArtifactRepository,
  assembleTrialArtifactPackage,
} from "../src/artifacts";
import {
  createSmokeGraderResults,
  unavailableBrowserGrade,
  type SmokeBuildResult,
} from "../src/controlled-run-results";
import { deriveTrialOutcome } from "../src/domain";
import { updatesFilterSmokeTrial } from "../src/fixture";
import { runLocalTrial } from "../src/local-runner";
import {
  cancellationRequested,
  decideAdmission,
  type ActiveAdmission,
  type AdmissionRequest,
} from "../src/run-admission-contract";
import { internalRunPolicy, retentionExpiresAt, runIdSchema } from "../src/run-policy";
import {
  approvedTrialTools,
  isApprovedTrialTool,
  resolveWorkspacePath,
  resolveWritableWorkspacePath,
} from "../src/trial-tool-policy";
import { evaluateUpdatesFilterObservations } from "../src/updates-filter-grader";

const at = new Date("2026-07-20T12:00:00.000Z");
const request: AdmissionRequest = {
  runId: "run-1",
  identityId: "access-user-1",
  admittedAt: at.toISOString(),
  expiresAt: "2026-07-20T12:15:00.000Z",
  retentionExpiresAt: "2026-07-27T12:00:00.000Z",
  limits: internalRunPolicy.limits,
};

const successfulBuild: SmokeBuildResult = {
  install: { phase: "install", success: true, stdout: "", stderr: "", exitCode: 0 },
  build: { phase: "build", success: true, stdout: "", stderr: "", exitCode: 0 },
};

describe("cloud readiness contracts", () => {
  it("accepts any valid Access identity without an email allowlist", () => {
    const identity = validateAccessClaims(
      {
        iss: "https://team.cloudflareaccess.com",
        aud: ["docs-trials-audience"],
        sub: "access-user-1",
        email: "person@example.com",
        iat: 1_784_569_000,
        exp: 1_784_570_000,
      },
      { teamDomain: "team.cloudflareaccess.com", audience: "docs-trials-audience" },
      at,
    );

    expect(identity).toEqual({ id: "access-user-1", email: "person@example.com" });
  });

  it("rejects expired or wrong-audience Access claims", () => {
    const configuration = {
      teamDomain: "team.cloudflareaccess.com",
      audience: "docs-trials-audience",
    };
    expect(() =>
      validateAccessClaims(
        {
          iss: "https://team.cloudflareaccess.com",
          aud: "other",
          sub: "user",
          iat: 1,
          exp: 1_784_570_000,
        },
        configuration,
        at,
      ),
    ).toThrow("audience");
    expect(() =>
      validateAccessClaims(
        {
          iss: "https://team.cloudflareaccess.com",
          aud: "docs-trials-audience",
          sub: "user",
          iat: 1,
          exp: 1,
        },
        configuration,
        at,
      ),
    ).toThrow("expired");
  });

  it("enforces one active run and idempotent admission retries", () => {
    const first = decideAdmission(null, request);
    expect(first).toMatchObject({ accepted: true, idempotent: false });
    if (!first.accepted) throw new Error("Expected admission to succeed.");

    expect(decideAdmission(first.admission, request)).toMatchObject({
      accepted: true,
      idempotent: true,
    });
    expect(decideAdmission(first.admission, { ...request, runId: "run-2" })).toEqual({
      accepted: false,
      reason: "active-run-exists",
      activeRunId: "run-1",
    });
  });

  it("keeps an expired run admitted until cleanup and detects its deadline", () => {
    const expired: ActiveAdmission = { ...request, expiresAt: "2026-07-20T11:59:59.000Z" };
    expect(decideAdmission(expired, { ...request, runId: "run-2" })).toEqual({
      accepted: false,
      reason: "active-run-exists",
      activeRunId: "run-1",
    });
    expect(cancellationRequested(expired, request.runId, at)).toBe(true);
    const cancelled: ActiveAdmission = {
      ...request,
      cancellationRequestedAt: "2026-07-20T12:01:00.000Z",
    };
    for (const phase of ["prepare", "execute", "build", "preview", "verify", "report"]) {
      expect(cancellationRequested(cancelled, request.runId, at), phase).toBe(true);
    }
  });

  it("freezes bounded resource and seven-day retention defaults", () => {
    expect(internalRunPolicy.limits.maxAgentSteps).toBe(12);
    expect(internalRunPolicy.limits.maxWorkflowSeconds).toBe(900);
    expect(retentionExpiresAt(at, internalRunPolicy.retention.days)).toBe(
      "2026-07-27T12:00:00.000Z",
    );
    expect(runIdSchema.parse("run-123")).toBe("run-123");
    expect(() => runIdSchema.parse("../unsafe")).toThrow("Invalid controlled run ID");
    expect(() => runIdSchema.parse("UPPERCASE")).toThrow("Invalid controlled run ID");
  });

  it("allows only approved documentation and workspace tools", () => {
    expect(approvedTrialTools).toEqual([
      "fetch_url",
      "workspace_list_files",
      "workspace_read_file",
      "workspace_write_file",
    ]);
    expect(isApprovedTrialTool("workspace_write_file")).toBe(true);
    expect(isApprovedTrialTool("bash")).toBe(false);
    expect(resolveWorkspacePath("src/App.jsx")).toBe("/workspace/app/src/App.jsx");
    expect(resolveWritableWorkspacePath("src/App.jsx")).toBe("/workspace/app/src/App.jsx");
    expect(() => resolveWritableWorkspacePath("package.json")).toThrow("not writable");
    expect(() => resolveWritableWorkspacePath("vite.config.js")).toThrow("not writable");
    expect(() => resolveWorkspacePath("../outside.txt")).toThrow("normalized relative path");
    expect(() => resolveWorkspacePath("/etc/passwd")).toThrow("normalized relative path");
  });

  it("distinguishes build, preview, and browser failure evidence", () => {
    const unavailable = unavailableBrowserGrade("Preview did not start.");
    const failedBuild = createSmokeGraderResults(
      {
        ...successfulBuild,
        build: { ...successfulBuild.build, success: false, exitCode: 1 },
      },
      {
        available: false,
        detail: "Preview skipped because the build failed.",
        failureKind: "application",
      },
      unavailable,
    );
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, failedBuild)).toBe(
      "failed",
    );

    const failedPreview = createSmokeGraderResults(
      successfulBuild,
      {
        available: false,
        detail: "Preview process exited before opening its port.",
        failureKind: "application",
      },
      unavailable,
    );
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, failedPreview)).toBe(
      "failed",
    );

    const unavailablePreview = createSmokeGraderResults(
      successfulBuild,
      {
        available: false,
        detail: "Sandbox tunnel was unavailable.",
        failureKind: "infrastructure",
      },
      unavailable,
    );
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, unavailablePreview)).toBe(
      "inconclusive",
    );

    const failedBrowser = createSmokeGraderResults(
      successfulBuild,
      { available: true, processId: "preview", url: "https://preview.invalid" },
      {
        sessionId: "browser",
        consoleMessages: ["Unhandled error"],
        networkFailures: [],
        screenshotCaptured: false,
        results: evaluateUpdatesFilterObservations({
          headingVisible: true,
          initialUpdateCount: 3,
          initialUpdateText: "Faster previews Clearer evidence Safer trial limits",
          platformUpdateCount: 1,
          platformUpdateText: "Faster previews",
          emptyMessageVisible: true,
          consoleMessages: ["Unhandled error"],
          networkFailures: [],
          unexpectedExternalRequests: [],
        }),
      },
    );
    expect(deriveTrialOutcome(updatesFilterSmokeTrial.acceptanceCriteria, failedBrowser)).toBe(
      "failed",
    );
  });

  it("assembles a complete redacted package without contacting Artifacts", async () => {
    const local = runLocalTrial(updatesFilterSmokeTrial, at);
    const trialPackage = assembleTrialArtifactPackage({
      spec: updatesFilterSmokeTrial,
      run: local.run,
      report: local.report,
      generatedSource: [{ path: "src/App.jsx", content: 'const token = "private-token";' }],
      agentTrace: {
        authorization: "Bearer private-token",
        accessToken: "private-access-token",
        output: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      },
      commands: { stdout: "password=private-password\nCookie: session=private-cookie" },
      browserSummary: { consoleMessages: [] },
      screenshot: new Uint8Array([1, 2, 3]),
      maxBytes: internalRunPolicy.limits.maxEvidenceBytes,
    });
    const paths = trialPackage.files.map((file) => file.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "trial.json",
        "run.json",
        "agent-trace.jsonl",
        "commands.jsonl",
        "browser-evidence/summary.json",
        "browser-evidence/final.png",
        "grader-results.json",
        "generated-source/src/App.jsx",
        "AX.md",
      ]),
    );
    expect(
      trialPackage.files
        .filter((file) => typeof file.content === "string")
        .every((file) => !String(file.content).includes("private-token")),
    ).toBe(true);
    const trace = trialPackage.files.find((file) => file.path === "agent-trace.jsonl");
    expect(() => JSON.parse(String(trace?.content).trim())).not.toThrow();
    expect(String(trace?.content)).not.toContain("private-access-token");
    expect(String(trace?.content)).not.toContain("eyJhbGci");
    await expect(new UnavailableArtifactRepository().save(trialPackage)).rejects.toBeInstanceOf(
      ArtifactsUnavailableError,
    );
  });

  it("rejects oversized or unsafe artifact packages", () => {
    const local = runLocalTrial(updatesFilterSmokeTrial, at);
    expect(() =>
      assembleTrialArtifactPackage({
        spec: updatesFilterSmokeTrial,
        run: local.run,
        report: local.report,
        generatedSource: [{ path: "../escape.js", content: "x" }],
        agentTrace: {},
        commands: {},
        browserSummary: {},
        maxBytes: 1_024,
      }),
    ).toThrow();
    expect(() =>
      assembleTrialArtifactPackage({
        spec: updatesFilterSmokeTrial,
        run: local.run,
        report: local.report,
        generatedSource: [{ path: "src/large.js", content: "x".repeat(2_000) }],
        agentTrace: {},
        commands: {},
        browserSummary: {},
        maxBytes: 1_024,
      }),
    ).toThrow("exceeds evidence limit");
  });
});
