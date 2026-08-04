import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { digestStarterFiles, prepareAiSearchPrivateRun, sha256 } from "../src/ai-search/contract";
import { aiSearchResearchTrial } from "../src/ai-search/fixture";
import { builtInStarterManifests } from "../src/starter-assets";

const args = process.argv.slice(2);
const requestedRunId = args[0] === "--" ? args[1] : args[0];
const runId = requestedRunId ?? `ais-${Date.now().toString(36)}`;
const maxResourceBytes = 1_000_000;
const retrieved = await Promise.all(
  aiSearchResearchTrial.resources.map(async (resource, index) => {
    const sourceUrl = new URL("index.md", resource.locator).toString();
    const response = await fetch(sourceUrl, {
      headers: { accept: "text/markdown" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Unable to freeze assigned documentation: ${resource.locator}`);
    }
    if (response.url !== sourceUrl) {
      throw new Error(`Assigned documentation resolved to an unexpected URL: ${response.url}`);
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "text/markdown") {
      throw new Error(`Assigned documentation is not Markdown: ${resource.locator}`);
    }
    if (!response.body) {
      throw new Error(`Assigned documentation returned no body: ${resource.locator}`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxResourceBytes) {
        await reader.cancel();
        throw new Error(`Assigned documentation snapshot is too large: ${resource.locator}`);
      }
      chunks.push(value);
    }
    if (byteLength === 0) {
      throw new Error(`Assigned documentation returned an empty body: ${resource.locator}`);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const path = `assigned-docs/${String(index + 1).padStart(2, "0")}.md`;
    return {
      content,
      snapshot: {
        locator: resource.locator,
        sourceUrl: response.url,
        retrievedAt: new Date().toISOString(),
        mediaType: "text/markdown" as const,
        path,
        sha256: await sha256(content),
      },
    };
  }),
);
const prepared = await prepareAiSearchPrivateRun(
  runId,
  retrieved.map(({ snapshot }) => snapshot),
);
const outputRoot = resolve("trial-output");
const outputDir = join(outputRoot, runId);
const workspaceDir = join(outputDir, "workspace");
const starter = builtInStarterManifests[prepared.trial.starterRepository.source];
if (!starter) throw new Error("The AI Search starter manifest is unavailable.");
const starterDir = resolve(starter.sourceDirectory);
const starterFiles = await Promise.all(
  starter.files.map(async (path) => ({
    path,
    content: await readFile(join(starterDir, path), "utf8"),
  })),
);
const starterRevision = `sha256:${await digestStarterFiles(starterFiles)}`;
if (starterRevision !== prepared.trial.starterRepository.revision) {
  throw new Error("The AI Search starter contents do not match the frozen revision.");
}

await mkdir(outputRoot, { recursive: true });
try {
  await mkdir(outputDir);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    throw new Error(`AI Search run already exists and will not be overwritten: ${runId}`);
  }
  throw error;
}
await mkdir(workspaceDir);
for (const file of starterFiles) {
  const destination = join(workspaceDir, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.content);
}

await mkdir(join(workspaceDir, "knowledge"), { recursive: true });
for (const document of prepared.knowledge.documents) {
  await writeFile(join(workspaceDir, "knowledge", document.key), document.content);
}
await mkdir(join(workspaceDir, "assigned-docs"), { recursive: true });
for (const { content, snapshot } of retrieved) {
  await writeFile(join(workspaceDir, snapshot.path), content);
}

await writeFile(join(outputDir, "private-run.json"), JSON.stringify(prepared, null, 2));
await writeFile(join(outputDir, "AGENT_INSTRUCTIONS.md"), renderInstructions(prepared));

console.log(
  JSON.stringify({
    status: "prepared",
    runId,
    outputDir,
    workspaceDir,
    liveResourcesCreated: false,
    next: "Give AGENT_INSTRUCTIONS.md to the coding agent. Do not authorize a live run yet.",
  }),
);

function renderInstructions(run: Awaited<ReturnType<typeof prepareAiSearchPrivateRun>>): string {
  const resources = run.resourceSnapshots
    .map(
      (resource) =>
        `- \`${resource.path}\` from ${resource.locator} (retrieved ${resource.retrievedAt}, SHA-256 \`${resource.sha256}\`)`,
    )
    .join("\n");
  return `# Docs Trials AI Search Run\n\nRun: \`${run.runId}\`\n\n## Task\n\n${run.trial.task}\n\n## Assigned Documentation\n\n${resources}\n\n## Frozen Resources\n\n- Namespace: \`${run.resources.namespace}\`\n- Instance: \`${run.resources.instance}\`\n- Knowledge files: ${run.knowledge.documents.map((document) => `\`${document.key}\``).join(", ")}\n\n## Safety Boundary\n\n- Use only the assigned documentation as trial evidence.\n- Do not run \`wrangler login\`, deploy, create cloud resources, or open the Cloudflare dashboard.\n- Do not add API tokens, account credentials, or real internal data.\n- Implement the task and its configuration in the supplied workspace. A trusted harness will review the source and perform any privileged execution later.\n- Do not claim that the task passed. Docs Trials owns verification and cleanup.\n`;
}
