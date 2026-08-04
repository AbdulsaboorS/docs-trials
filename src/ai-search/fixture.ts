import { trialSpecSchema } from "../domain";
import { aiSearchRunIdSchema } from "./policy";

export const aiSearchDocumentKeys = [
  "project-atlas.md",
  "incident-response.md",
  "vendor-access.md",
] as const;

export const aiSearchCriteria = {
  build: "The generated Worker installs and builds successfully.",
  instance: "Exactly the run-scoped AI Search instance exists in the isolated namespace.",
  indexing: "All three supplied knowledge documents reach an indexed state.",
  mcpTool: "The public MCP endpoint is enabled and lists the AI Search tool.",
  research:
    "An MCP research request returns the run-specific Project Atlas fact and its source document.",
  credentials: "No credential-shaped value appears in generated source or retained evidence.",
  cleanup:
    "The temporary Worker, AI Search instance, and namespace are deleted and confirmed absent.",
} as const;

export const aiSearchResearchTrial = trialSpecSchema.parse({
  id: "ai-search-internal-research-v1",
  title: "AI Search internal knowledge for agent research",
  task: "Using only the assigned AI Search documentation and starter workspace, configure a run-scoped AI Search namespace binding, create exactly one built-in-storage instance, upload and await indexing for all three supplied Markdown files, expose the instance's built-in MCP search tool, and make the supplied research question return the run-specific fact and source.",
  starterRepository: {
    source: "builtin:ai-search-research-starter-v1",
    revision: "sha256:c284b81048dad3280c326f9f9b0e0c51f0f83eed3dc81fc9176cd871280658ae",
  },
  resources: [
    {
      kind: "website",
      locator: "https://developers.cloudflare.com/ai-search/get-started/workers/",
      revision: "retrieved:2026-07-21",
      retrievedAt: "2026-07-21T00:00:00.000Z",
    },
    {
      kind: "website",
      locator: "https://developers.cloudflare.com/ai-search/api/items/workers-binding/",
      revision: "retrieved:2026-07-21",
      retrievedAt: "2026-07-21T00:00:00.000Z",
    },
    {
      kind: "website",
      locator: "https://developers.cloudflare.com/ai-search/how-to/connect-mcp-client/",
      revision: "retrieved:2026-07-21",
      retrievedAt: "2026-07-21T00:00:00.000Z",
    },
  ],
  runtime: {
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand: "pnpm build",
    startCommand:
      "node -e \"throw new Error('Live start requires the trusted Docs Trials provider adapter')\"",
  },
  acceptanceCriteria: Object.values(aiSearchCriteria),
});

export function createAiSearchKnowledgeFixture(runId: string) {
  const parsed = aiSearchRunIdSchema.parse(runId);
  const researchCode = `ORBIT-${parsed.toUpperCase()}-731`;
  const documents = [
    {
      key: aiSearchDocumentKeys[0],
      content: `# Project Atlas\n\nProject Atlas uses research authorization code **${researchCode}**. The weekly change window starts Tuesday at 14:30 UTC. The rollback owner is the Northstar team.\n`,
    },
    {
      key: aiSearchDocumentKeys[1],
      content:
        "# Incident Response\n\nSeverity One incidents use the internal channel `#incident-bridge`. The incident commander records a timeline before handing off to the recovery owner.\n",
    },
    {
      key: aiSearchDocumentKeys[2],
      content:
        "# Vendor Access\n\nTemporary vendor access expires after six hours. The sponsoring team must remove access when the review is complete.\n",
    },
  ] as const;

  return {
    documents,
    researchQuestion: "What is the research authorization code for Project Atlas?",
    expectedFact: researchCode,
    expectedSourceKey: aiSearchDocumentKeys[0],
  };
}
