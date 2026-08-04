import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFrozenAiSearchPrivateRun,
  digestStarterFiles,
  prepareAiSearchPrivateRun,
  sha256,
} from "../src/ai-search/contract";
import { aiSearchDocumentKeys, aiSearchResearchTrial } from "../src/ai-search/fixture";
import {
  assertNonLiveAiSearchObservations,
  deriveAiSearchTerminalOutcome,
  gradeAiSearchTrial,
  type AiSearchObservations,
} from "../src/ai-search/grader";
import { aiSearchDeploymentConfigSchema, aiSearchResourcePolicy } from "../src/ai-search/policy";
import { aiSearchStarterFiles } from "../src/starter-assets";

const runId = "ais-test-001";

describe("AI Search connected trial", () => {
  it("prepares a bounded credential-free private run", async () => {
    const run = await prepareRun(new Date("2026-07-21T12:00:00.000Z"));

    expect(run.liveResourcesCreated).toBe(false);
    expect(run.resources).toEqual({
      namespace: "dt-ais-test-001",
      instance: "internal-research",
      worker: "dt-ai-search-ais-test-001",
    });
    expect(run.knowledge.documents.map((document) => document.key)).toEqual(aiSearchDocumentKeys);
    expect(run.knowledge.documents).toHaveLength(aiSearchResourcePolicy.maxDocuments);
    expect(
      run.knowledge.documents.every(
        (document) => new TextEncoder().encode(document.content).byteLength < 4_096,
      ),
    ).toBe(true);
    expect(
      run.knowledge.documents.every((document) => /^[a-f0-9]{64}$/.test(document.sha256)),
    ).toBe(true);
    expect(run.knowledge.expectedFact).toContain(runId.toUpperCase());
    expect(run.trial.resources).toEqual(
      run.resourceSnapshots.map((snapshot) => ({
        ...aiSearchResearchTrial.resources.find(
          (resource) => resource.locator === snapshot.locator,
        )!,
        revision: `sha256:${snapshot.sha256}`,
        retrievedAt: snapshot.retrievedAt,
      })),
    );
    expect(JSON.stringify(run)).not.toMatch(/api[_-]?token|bearer\s+/i);
  });

  it("content-addresses the complete starter manifest", async () => {
    const files = await Promise.all(
      aiSearchStarterFiles.map(async (path) => ({
        path,
        content: await readFile(resolve("fixtures", "ai-search-research-starter", path), "utf8"),
      })),
    );
    expect(aiSearchResearchTrial.starterRepository.revision).toBe(
      `sha256:${await digestStarterFiles(files)}`,
    );
  });

  it("passes only when resource, MCP, credential, and cleanup evidence is complete", async () => {
    const run = await prepareRun();
    const results = gradeAiSearchTrial(run, passingObservations(run));

    expect(results).toHaveLength(aiSearchResearchTrial.acceptanceCriteria.length);
    expect(results.every((result) => result.outcome === "passed")).toBe(true);
    expect(deriveAiSearchTerminalOutcome(aiSearchResearchTrial.acceptanceCriteria, results)).toBe(
      "passed",
    );
    expect(() => assertNonLiveAiSearchObservations(passingObservations(run))).toThrow(
      "future trusted provider adapter",
    );
  });

  it("accepts only the run-scoped deployment binding", async () => {
    const run = await prepareRun();
    const schema = aiSearchDeploymentConfigSchema(run.resources);
    const config = {
      $schema: "./node_modules/wrangler/config-schema.json",
      name: run.resources.worker,
      main: "src/index.ts",
      compatibility_date: "2026-07-21",
      ai_search_namespaces: [
        { binding: "AI_SEARCH", namespace: run.resources.namespace, remote: true },
      ],
    };

    expect(schema.parse(config)).toEqual(config);
    expect(() => schema.parse({ ...config, routes: [{ pattern: "example.com/*" }] })).toThrow();
    expect(() =>
      schema.parse({
        ...config,
        ai_search_namespaces: [{ binding: "AI_SEARCH", namespace: "default", remote: true }],
      }),
    ).toThrow();
  });

  it("rejects a modified frozen contract", async () => {
    const run = await prepareRun();
    const modified = structuredClone(run);
    modified.knowledge.researchQuestion = "Use a different grader question.";

    await expect(assertFrozenAiSearchPrivateRun(modified)).rejects.toThrow("frozen contract");
  });

  it("binds timestamps and exact resource snapshot paths into the contract", async () => {
    const run = await prepareRun();
    const modified = structuredClone(run);
    modified.createdAt = "2026-07-21T12:00:01.000Z";
    await expect(assertFrozenAiSearchPrivateRun(modified)).rejects.toThrow("frozen contract");

    const snapshots = run.resourceSnapshots.map((snapshot) => ({ ...snapshot }));
    snapshots[0]!.path = "assigned-docs/02.md";
    await expect(
      prepareAiSearchPrivateRun(runId, snapshots, new Date(run.createdAt)),
    ).rejects.toThrow("assigned documentation");
  });

  it("preserves dashboard-only MCP enablement as an observed failure", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    observations.mcp = {
      available: true,
      collectedAt,
      value: {
        namespace: run.resources.namespace,
        instance: run.resources.instance,
        instancePublicId: "trial-public-id",
        endpointHost: "trial-public-id.search.ai.cloudflare.com",
        endpointEnabled: false,
        searchToolListed: false,
        actor: "coding-agent",
        requestMethod: "tools/call",
        requestQuery: run.knowledge.researchQuestion,
        responseText: "",
        sourceKeys: [],
      },
    };

    const results = gradeAiSearchTrial(run, observations);
    expect(
      results.filter((result) => result.outcome === "failed").map((result) => result.criterion),
    ).toEqual([
      "The public MCP endpoint is enabled and lists the AI Search tool.",
      "An MCP research request returns the run-specific Project Atlas fact and its source document.",
    ]);
    expect(deriveAiSearchTerminalOutcome(aiSearchResearchTrial.acceptanceCriteria, results)).toBe(
      "failed",
    );
  });

  it("rejects duplicate indexed items that omit expected documents", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    if (!observations.indexing.available) throw new Error("Expected available indexing fixture.");
    const first = observations.indexing.value.items[0]!;
    observations.indexing.value.items = [first, first, first];

    const results = gradeAiSearchTrial(run, observations);
    expect(
      results.find((result) => result.criterion.includes("knowledge documents"))?.outcome,
    ).toBe("failed");
  });

  it("binds the credential scan to the built source manifest", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    if (!observations.credentialScan.available) {
      throw new Error("Expected available credential scan fixture.");
    }
    observations.credentialScan.value.sourceManifestSha256 = "b".repeat(64);

    const results = gradeAiSearchTrial(run, observations);
    expect(results.find((result) => result.criterion.includes("credential"))?.outcome).toBe(
      "failed",
    );
  });

  it("does not credit a manual dashboard action to the coding agent", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    if (!observations.mcp.available) throw new Error("Expected available MCP fixture.");
    observations.mcp.value.actor = "human";

    const results = gradeAiSearchTrial(run, observations);
    expect(results.find((result) => result.criterion.includes("MCP endpoint"))?.outcome).toBe(
      "failed",
    );
  });

  it("quarantines incomplete cleanup without calling it a documentation failure", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    observations.cleanup = {
      available: true,
      collectedAt,
      value: {
        worker: run.resources.worker,
        namespace: run.resources.namespace,
        instance: run.resources.instance,
        workerAbsent: true,
        instanceAbsent: false,
        namespaceAbsent: false,
      },
    };

    const results = gradeAiSearchTrial(run, observations);
    const cleanup = results.at(-1);
    expect(cleanup?.outcome).toBe("inconclusive");
    expect(cleanup?.detail).toContain("Admission must remain quarantined");
    expect(deriveAiSearchTerminalOutcome(aiSearchResearchTrial.acceptanceCriteria, results)).toBe(
      "inconclusive",
    );
  });

  it("treats unavailable provider evidence as inconclusive", async () => {
    const run = await prepareRun();
    const observations = passingObservations(run);
    observations.instances = {
      available: false,
      collectedAt,
      detail: "Provider API timed out.",
    };

    const results = gradeAiSearchTrial(run, observations);
    expect(results.find((result) => result.criterion.includes("run-scoped"))?.outcome).toBe(
      "inconclusive",
    );
    expect(deriveAiSearchTerminalOutcome(aiSearchResearchTrial.acceptanceCriteria, results)).toBe(
      "inconclusive",
    );
  });
});

const collectedAt = "2026-07-21T12:10:00.000Z";

async function prepareRun(createdAt = new Date("2026-07-21T12:00:00.000Z")) {
  const contents = ["# Workers binding", "# Items API", "# MCP client"];
  const snapshots = await Promise.all(
    aiSearchResearchTrial.resources.map(async (resource, index) => ({
      locator: resource.locator,
      sourceUrl: new URL("index.md", resource.locator).toString(),
      retrievedAt: "2026-07-21T11:00:00.000Z",
      mediaType: "text/markdown" as const,
      path: `assigned-docs/${String(index + 1).padStart(2, "0")}.md`,
      sha256: await sha256(contents[index]!),
    })),
  );
  return prepareAiSearchPrivateRun(runId, snapshots, createdAt);
}

function passingObservations(
  run: Awaited<ReturnType<typeof prepareAiSearchPrivateRun>>,
): AiSearchObservations {
  return {
    build: {
      available: true,
      collectedAt,
      value: {
        command: run.trial.runtime.buildCommand,
        exitCode: 0,
        sourceManifestSha256: "a".repeat(64),
      },
    },
    instances: {
      available: true,
      collectedAt,
      value: {
        namespace: run.resources.namespace,
        ids: [run.resources.instance],
        total: 1,
      },
    },
    indexing: {
      available: true,
      collectedAt,
      value: {
        namespace: run.resources.namespace,
        instance: run.resources.instance,
        total: run.knowledge.documents.length,
        items: run.knowledge.documents.map((document) => ({
          key: document.key,
          status: "indexed" as const,
          sha256: document.sha256,
        })),
      },
    },
    mcp: {
      available: true,
      collectedAt,
      value: {
        namespace: run.resources.namespace,
        instance: run.resources.instance,
        instancePublicId: "trial-public-id",
        endpointHost: "trial-public-id.search.ai.cloudflare.com",
        endpointEnabled: true,
        searchToolListed: true,
        actor: "coding-agent",
        requestMethod: "tools/call",
        requestQuery: run.knowledge.researchQuestion,
        responseText: `Project Atlas uses ${run.knowledge.expectedFact}.`,
        sourceKeys: [run.knowledge.expectedSourceKey],
      },
    },
    credentialScan: {
      available: true,
      collectedAt,
      value: {
        scannedScopes: ["generated-source", "retained-evidence"],
        sourceManifestSha256: "a".repeat(64),
        matches: [],
      },
    },
    cleanup: {
      available: true,
      collectedAt,
      value: {
        worker: run.resources.worker,
        namespace: run.resources.namespace,
        instance: run.resources.instance,
        workerAbsent: true,
        instanceAbsent: true,
        namespaceAbsent: true,
      },
    },
  };
}
