import { describe, expect, it, vi } from "vitest";
import { validateAccessClaims } from "../src/access-auth";
import {
  CloudflareArtifactRepository,
  assembleTrialArtifactPackage,
  requireSuccessfulArtifactOperation,
  type ArtifactGitWorkspace,
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

  it("assembles a complete redacted package without contacting Artifacts", () => {
    const local = runLocalTrial(updatesFilterSmokeTrial, at);
    const trialPackage = assembleTrialArtifactPackage({
      spec: updatesFilterSmokeTrial,
      run: local.run,
      report: local.report,
      generatedSource: [
        {
          path: "src/App.jsx",
          content: [
            'const token = "private-token";',
            "VITE_API_KEY=private-vite-key",
            "-----BEGIN PRIVATE KEY-----",
            "private-key-material",
            "-----END PRIVATE KEY-----",
          ].join("\n"),
        },
      ],
      agentTrace: {
        authorization: "Bearer private-token",
        authToken: "private-auth-token",
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
    expect(String(trace?.content)).not.toContain("private-auth-token");
    expect(String(trace?.content)).not.toContain("eyJhbGci");
    const source = trialPackage.files.find((file) => file.path === "generated-source/src/App.jsx");
    expect(String(source?.content)).not.toContain("private-vite-key");
    expect(String(source?.content)).not.toContain("private-key-material");
  });

  it("creates an immutable Artifacts repo and revokes short-lived credentials", async () => {
    const initialToken = "art_v1_initial?expires=1784654000";
    const writeToken = "art_v1_write?expires=1784654000";
    const revokeToken = vi.fn(async () => true);
    const repo = {
      remote: "https://account.artifacts.cloudflare.net/git/docs-trials/run-1.git",
      createToken: vi.fn(async () => ({
        id: "token-1",
        plaintext: writeToken,
        scope: "write" as const,
        expiresAt: "2026-07-21T17:00:00.000Z",
      })),
      listTokens: vi
        .fn()
        .mockResolvedValueOnce({
          tokens: [
            {
              id: "stale-write",
              scope: "write" as const,
              state: "active" as const,
              createdAt: "2026-07-21T16:00:00.000Z",
              expiresAt: "2026-07-21T17:00:00.000Z",
            },
            {
              id: "active-read",
              scope: "read" as const,
              state: "active" as const,
              createdAt: "2026-07-21T16:00:00.000Z",
              expiresAt: "2026-07-21T17:00:00.000Z",
            },
          ],
          total: 2,
        })
        .mockResolvedValue({ tokens: [], total: 0 }),
      revokeToken,
    } as unknown as ArtifactsRepo;
    const artifacts = {
      create: vi.fn(async () => ({ token: initialToken })),
      get: vi.fn(async () => repo),
      delete: vi.fn(async () => true),
    } as unknown as Artifacts;
    const persist = vi.fn(async () => "a".repeat(40));
    const workspace = { persist } satisfies ArtifactGitWorkspace;
    const repository = new CloudflareArtifactRepository(artifacts, () => workspace);

    await expect(
      repository.save({
        repository: "run-1",
        files: [
          { path: "run.json", mediaType: "application/json", content: "{}" },
          { path: "AX.md", mediaType: "text/markdown", content: "# Report\n" },
        ],
      }),
    ).resolves.toEqual({ repository: "run-1", version: "a".repeat(40) });
    expect(artifacts.create).toHaveBeenCalledWith("run-1", {
      description: "Docs Trials evidence for run-1",
      readOnly: false,
      setDefaultBranch: "main",
    });
    expect(revokeToken).toHaveBeenNthCalledWith(1, initialToken);
    expect(revokeToken).toHaveBeenNthCalledWith(2, "stale-write");
    expect(revokeToken).toHaveBeenNthCalledWith(3, writeToken);
    expect(revokeToken).not.toHaveBeenCalledWith("active-read");
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ repository: "run-1", token: writeToken }),
    );
    await expect(repository.delete("run-1")).resolves.toBe(true);
    expect(artifacts.delete).toHaveBeenCalledWith("run-1");
  });

  it("reuses an existing repo and deletes a partial newly-created repo on failure", async () => {
    const writeToken = "art_v1_write_secret?expires=1784654000";
    const repo = {
      remote: "https://account.artifacts.cloudflare.net/git/docs-trials/run-1.git",
      createToken: vi.fn(async () => ({
        id: "token-1",
        plaintext: writeToken,
        scope: "write" as const,
        expiresAt: "2026-07-21T17:00:00.000Z",
      })),
      listTokens: vi.fn(async () => ({ tokens: [], total: 0 })),
      revokeToken: vi.fn(async () => true),
    } as unknown as ArtifactsRepo;
    const deleteRepo = vi.fn(async () => true);
    const existingArtifacts = {
      create: vi.fn(async () => {
        throw Object.assign(new Error("exists"), { code: "ALREADY_EXISTS" });
      }),
      get: vi.fn(async () => repo),
      delete: deleteRepo,
    } as unknown as Artifacts;
    const successful = new CloudflareArtifactRepository(existingArtifacts, () => ({
      persist: vi.fn(async () => "b".repeat(40)),
    }));
    const trialPackage = {
      repository: "run-1",
      files: [{ path: "AX.md", mediaType: "text/markdown", content: "# Report\n" }],
    };

    await expect(successful.save(trialPackage)).resolves.toEqual({
      repository: "run-1",
      version: "b".repeat(40),
    });
    expect(deleteRepo).not.toHaveBeenCalled();

    const createdArtifacts = {
      create: vi.fn(async () => ({ token: "art_v1_initial?expires=1784654000" })),
      get: vi.fn(async () => repo),
      delete: deleteRepo,
    } as unknown as Artifacts;
    const failing = new CloudflareArtifactRepository(createdArtifacts, () => ({
      persist: vi.fn(async () => {
        throw new Error(`Bearer ${writeToken}`);
      }),
    }));
    const error = await failing.save(trialPackage).catch((caught: unknown) => caught);
    expect(String(error)).toContain("Artifacts persistence failed");
    expect(String(error)).not.toContain(writeToken);
    expect(deleteRepo).toHaveBeenCalledWith("run-1");
  });

  it("uses a stable package digest and rejects duplicate paths before persistence", async () => {
    const digests: string[] = [];
    const repo = {
      remote: "https://account.artifacts.cloudflare.net/git/docs-trials/run-1.git",
      createToken: vi.fn(async () => ({
        id: "token-1",
        plaintext: "art_v1_write?expires=1784654000",
        scope: "write" as const,
        expiresAt: "2026-07-21T17:00:00.000Z",
      })),
      listTokens: vi.fn(async () => ({ tokens: [], total: 0 })),
      revokeToken: vi.fn(async () => true),
    } as unknown as ArtifactsRepo;
    const artifacts = {
      create: vi.fn(async () => ({ token: "art_v1_initial?expires=1784654000" })),
      get: vi.fn(async () => repo),
      delete: vi.fn(async () => true),
    } as unknown as Artifacts;
    const repository = new CloudflareArtifactRepository(artifacts, () => ({
      persist: vi.fn(async (input) => {
        digests.push(input.digest);
        return "c".repeat(40);
      }),
    }));
    const files = [
      { path: "run.json", mediaType: "application/json", content: "{}" },
      { path: "AX.md", mediaType: "text/markdown", content: "# Report\n" },
    ];

    await repository.save({ repository: "run-1", files });
    await repository.save({ repository: "run-1", files: [...files].reverse() });
    expect(digests[0]).toBe(digests[1]);
    await expect(
      repository.save({ repository: "run-1", files: [files[0]!, files[0]!] }),
    ).rejects.toThrow("Duplicate artifact path");
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
    expect(() =>
      assembleTrialArtifactPackage({
        spec: updatesFilterSmokeTrial,
        run: local.run,
        report: local.report,
        generatedSource: Array.from({ length: 251 }, (_, index) => ({
          path: `src/file-${index}.js`,
          content: "x",
        })),
        agentTrace: {},
        commands: {},
        browserSummary: {},
        maxBytes: internalRunPolicy.limits.maxEvidenceBytes,
      }),
    ).toThrow("exceeds 250 files");
    expect(() =>
      assembleTrialArtifactPackage({
        spec: updatesFilterSmokeTrial,
        run: local.run,
        report: local.report,
        generatedSource: [{ path: "src/unsafe-💥.js", content: "x" }],
        agentTrace: {},
        commands: {},
        browserSummary: {},
        maxBytes: internalRunPolicy.limits.maxEvidenceBytes,
      }),
    ).toThrow("Invalid artifact path");
  });

  it("rejects unsuccessful Sandbox file operations", async () => {
    await expect(
      requireSuccessfulArtifactOperation(
        "write run.json",
        Promise.resolve({ success: false, exitCode: 1 }),
      ),
    ).rejects.toThrow("write run.json failed with exit 1");
  });
});
