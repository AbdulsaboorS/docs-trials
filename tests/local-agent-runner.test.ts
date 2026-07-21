import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureLocalAgentRun, prepareLocalAgentRun } from "../src/local-agent-runner";

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

    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const instructions = await readFile(prepared.instructionsPath, "utf8");
    expect(instructions).toContain("Build a documented web application.");

    const captured = await captureLocalAgentRun(prepared.outputDir, workspace);
    expect(captured.status).toBe("inconclusive");
    const graderResults = JSON.parse(
      await readFile(join(prepared.outputDir, "grader-results.json"), "utf8"),
    ) as Array<{ outcome: string }>;
    expect(graderResults.map((result) => result.outcome)).toEqual(["passed", "inconclusive"]);
    const report = await readFile(join(prepared.outputDir, "AX.md"), "utf8");
    expect(report).toContain("PASS");
    expect(report).toContain("INCONCLUSIVE");
    expect(report).toContain("does not infer that the docs are at fault");
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

    const prepared = await prepareLocalAgentRun(manifest, workspace);
    const captured = await captureLocalAgentRun(prepared.outputDir, workspace);
    const report = await readFile(join(prepared.outputDir, "AX.md"), "utf8");

    expect(captured.status).toBe("failed");
    expect(report).toContain("**FAILED**");
    expect(report).toContain("before attributing the failure to documentation");
  });
});
