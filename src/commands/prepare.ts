import { resolve } from "node:path";
import { docLabel, loadManifest, type Manifest } from "../core/manifest";
import { createRunId, runDirectory, writeArtifact, writeRunRecord } from "../core/run";
import { readBaseline } from "../util/git";

export type PrepareOptions = { manifest: string; workspace: string };

export async function prepare(options: PrepareOptions) {
  const workspace = resolve(options.workspace);
  const { manifest, digest } = await loadManifest(options.manifest);
  const runId = createRunId(manifest.id);
  const baseline = await readBaseline(workspace);
  const instructions = renderInstructions(manifest);

  await writeRunRecord({
    runId,
    status: "prepared",
    manifest,
    manifestDigest: digest,
    workspace,
    ...(baseline ? { baselineRevision: baseline.revision } : {}),
    preparedAt: new Date().toISOString(),
  });
  const instructionsPath = await writeArtifact(runId, "AGENT_INSTRUCTIONS.md", instructions);

  return {
    runId,
    runDirectory: runDirectory(runId),
    instructionsPath,
    instructions,
    baseline,
    workspace,
  };
}

/**
 * The agent receives the task and the assigned documentation. It does not
 * receive the list of baseline checks. Publishing the checks would invite an
 * agent to satisfy the detector instead of building the integration.
 */
function renderInstructions(manifest: Manifest): string {
  return [
    "# Docs Trials task",
    "",
    "## What to build",
    "",
    manifest.task,
    "",
    "## Documentation you may use",
    "",
    ...manifest.docs.map((doc) => `- ${docLabel(doc)}`),
    "",
    "## Rules",
    "",
    "- Treat the documentation above as your only source for this product's API.",
    "- Work in this workspace. Leave your changes on disk when you finish.",
    "- Never put a persistent credential in code the browser downloads.",
    "- Do not claim the task passed. Verification runs separately after you stop.",
    "",
    "## How the result is produced",
    "",
    `Docs Trials will run \`${manifest.run.install}\`,` +
      (manifest.run.build ? ` \`${manifest.run.build}\`,` : "") +
      ` then \`${manifest.run.start}\`, and open ${manifest.run.url} in a browser.`,
    "",
  ].join("\n");
}
