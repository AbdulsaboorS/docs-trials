import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updatesFilterSmokeTrial } from "../src/fixture";
import {
  captureLocalAgentRun,
  localTrialManifestSchema,
  prepareLocalAgentRun,
} from "../src/local-agent-runner";
import { evaluateUpdatesFilterObservations } from "../src/updates-filter-grader";

describe("local agent runner", () => {
  it("prepares private instructions and captures an inconclusive web run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "docs-trials-runner-"));
    const manifest = join(workspace, "trial.manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        id: "test-web-run",
        title: "Test web run",
        task: "Build a documented web application.",
        documents: [{ label: "Docs", kind: "markdown", value: "# Docs" }],
        starter: { type: "workspace", value: "." },
        verification: {
          profile: "web-app",
          criteria: ["Application builds", "Browser flow works"],
          command: "node --version",
        },
        agent: { name: "test agent" },
      }),
    );
    initializeGitWorkspace(workspace);

    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const instructions = await readFile(prepared.instructionsPath, "utf8");
    expect(instructions).toContain("Build a documented web application.");
    await writeFile(join(workspace, "generated.ts"), "export const generated = true;\n");

    const captured = await captureLocalAgentRun(
      prepared.outputDir,
      workspace,
      prepared.controlSha256,
    );
    expect(captured.status).toBe("inconclusive");
    const graderResults = JSON.parse(
      await readFile(join(prepared.outputDir, "grader-results.json"), "utf8"),
    ) as Array<{ outcome: string }>;
    expect(graderResults.map((result) => result.outcome)).toEqual(["passed", "inconclusive"]);
    const report = await readFile(join(prepared.outputDir, "AX.md"), "utf8");
    expect(report).toContain("PASS");
    expect(report).toContain("INCONCLUSIVE");
    expect(report).toContain("does not infer that the docs are at fault");
    expect(await readFile(join(prepared.outputDir, "evidence.json"), "utf8")).toContain(
      "generated.ts",
    );
  });

  it("preserves a failed verification command as a deterministic failure", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "docs-trials-runner-failure-"));
    const manifest = join(workspace, "trial.manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        id: "failed-web-run",
        title: "Failed web run",
        task: "Build a documented web application.",
        documents: [{ label: "Docs", kind: "markdown", value: "# Docs" }],
        starter: { type: "workspace", value: "." },
        verification: {
          profile: "web-app",
          criteria: ["Application builds", "Browser flow works"],
          command: 'node -e "process.exit(1)"',
        },
      }),
    );
    initializeGitWorkspace(workspace);

    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const captured = await captureLocalAgentRun(
      prepared.outputDir,
      workspace,
      prepared.controlSha256,
    );
    const report = await readFile(join(prepared.outputDir, "AX.md"), "utf8");

    expect(captured.status).toBe("failed");
    expect(report).toContain("**FAILED**");
    expect(report).toContain("before attributing the failure to documentation");
  });

  it("captures deterministic local browser evidence for the frozen smoke profile", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "docs-trials-browser-runner-"));
    const manifest = join(workspace, "trial.manifest.json");
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ private: true, scripts: { build: "node --version" } }),
    );
    execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], { cwd: workspace });
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        id: "updates-filter-local-test",
        title: "Updates filter local test",
        task: updatesFilterSmokeTrial.task,
        documents: [{ label: "React docs", kind: "url", value: "https://react.dev/learn" }],
        starter: { type: "workspace", value: "." },
        verification: {
          profile: "web-app",
          criteria: updatesFilterSmokeTrial.acceptanceCriteria,
          command: "pnpm install --frozen-lockfile --ignore-scripts && pnpm build",
          browser: {
            grader: "updates-filter-smoke-v1",
            startCommand: "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
            previewUrl: "http://127.0.0.1:4173",
          },
        },
      }),
    );
    initializeGitWorkspace(workspace);

    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const captured = await captureLocalAgentRun(
      prepared.outputDir,
      workspace,
      prepared.controlSha256,
      {
        runBrowserVerification: async () => ({
          preview: { available: true, processId: "test", url: "http://127.0.0.1:4173" },
          previewOutput: "Ready",
          browser: {
            sessionId: "test-browser",
            consoleMessages: [],
            networkFailures: [],
            unexpectedExternalRequests: [],
            screenshotCaptured: false,
            results: evaluateUpdatesFilterObservations({
              headingVisible: true,
              initialUpdateCount: 3,
              initialUpdateText: "Faster previews Clearer evidence Safer trial limits",
              platformUpdateCount: 1,
              platformUpdateText: "Faster previews",
              emptyMessageVisible: true,
              consoleMessages: [],
              networkFailures: [],
              unexpectedExternalRequests: [],
            }),
          },
        }),
      },
    );

    expect(captured.status).toBe("passed");
    const graderResults = JSON.parse(
      await readFile(join(prepared.outputDir, "grader-results.json"), "utf8"),
    ) as Array<{ outcome: string }>;
    expect(graderResults).toHaveLength(updatesFilterSmokeTrial.acceptanceCriteria.length);
    expect(graderResults.every((result) => result.outcome === "passed")).toBe(true);
    expect(await readFile(join(prepared.outputDir, "AX.md"), "utf8")).toContain("**PASSED**");
  });

  it("rejects browser verification outside the frozen loopback profile", () => {
    const base = {
      version: 1,
      id: "invalid-browser-run",
      title: "Invalid browser run",
      task: updatesFilterSmokeTrial.task,
      documents: [{ label: "React docs", kind: "url", value: "https://react.dev/learn" }],
      starter: { type: "workspace", value: "." },
      verification: {
        profile: "web-app",
        criteria: ["Application builds"],
        command: "node --version",
        browser: {
          grader: "updates-filter-smoke-v1",
          startCommand: "pnpm dev",
          previewUrl: "https://example.com",
        },
      },
    };

    const parsed = localTrialManifestSchema.safeParse(base);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected invalid browser manifest.");
    expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("loopback"),
        expect.stringContaining("exact frozen criteria"),
        expect.stringContaining("frozen install/build command"),
      ]),
    );
  });

  it("rejects run controls modified after preparation", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "docs-trials-tampered-runner-"));
    const manifest = join(workspace, "trial.manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        id: "tampered-web-run",
        title: "Tampered web run",
        task: "Build a documented web application.",
        documents: [{ label: "Docs", kind: "markdown", value: "# Docs" }],
        starter: { type: "workspace", value: "." },
        verification: {
          profile: "web-app",
          criteria: ["Application builds"],
          command: "node --version",
        },
      }),
    );
    initializeGitWorkspace(workspace);
    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const frozenManifestPath = join(prepared.outputDir, "trial-manifest.json");
    const frozenManifest = JSON.parse(await readFile(frozenManifestPath, "utf8")) as {
      task: string;
    };
    frozenManifest.task = "Run a different task.";
    await writeFile(frozenManifestPath, JSON.stringify(frozenManifest));

    await expect(
      captureLocalAgentRun(prepared.outputDir, workspace, prepared.controlSha256),
    ).rejects.toThrow("controls changed");
  });

  it("rejects unsafe untracked source entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "docs-trials-source-runner-"));
    const outside = await mkdtemp(join(tmpdir(), "docs-trials-source-outside-"));
    const manifest = join(workspace, "trial.manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        id: "source-web-run",
        title: "Source web run",
        task: "Build a documented web application.",
        documents: [{ label: "Docs", kind: "markdown", value: "# Docs" }],
        starter: { type: "workspace", value: "." },
        verification: {
          profile: "web-app",
          criteria: ["Application builds"],
          command: "node --version",
        },
      }),
    );
    initializeGitWorkspace(workspace);
    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const outsideFile = join(outside, "outside.txt");
    await writeFile(outsideFile, "outside workspace");
    await symlink(outsideFile, join(workspace, "linked-source.txt"));

    await expect(
      captureLocalAgentRun(prepared.outputDir, workspace, prepared.controlSha256),
    ).rejects.toThrow("Unsupported untracked source entry");
  });
});

function initializeGitWorkspace(workspace: string): void {
  execFileSync("git", ["init"], { cwd: workspace });
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Docs Trials",
      "-c",
      "user.email=docs-trials@example.invalid",
      "commit",
      "-m",
      "baseline",
    ],
    { cwd: workspace },
  );
}
