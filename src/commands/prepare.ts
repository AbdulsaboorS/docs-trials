import { resolve } from "node:path";
import { docLabel, inlineText, loadManifest, type Manifest } from "../core/manifest";
import {
  removeRunReservation,
  reserveRunDirectory,
  writeArtifact,
  writeRunRecord,
  type RunRecord,
} from "../core/run";
import { readBaseline } from "../util/git";

export type PrepareOptions = { manifest: string; workspace: string };

export async function prepare(options: PrepareOptions) {
  const workspace = resolve(options.workspace);
  const { manifest, digest } = await loadManifest(options.manifest);
  const preparedAt = new Date();
  const location = await reserveRunDirectory(manifest.id, preparedAt);
  const { runId } = location;
  const baseline = await readBaseline(workspace);
  const instructions = renderInstructions(manifest);

  const record: RunRecord = {
    runId,
    status: "prepared",
    manifest,
    manifestDigest: digest,
    workspace,
    preparedAt: preparedAt.toISOString(),
  };
  if (baseline) record.baselineRevision = baseline.revision;
  let instructionsPath: string;
  try {
    instructionsPath = await writeArtifact(location, "AGENT_INSTRUCTIONS.md", instructions);
    await writeRunRecord(location, record);
  } catch (error) {
    await removeRunReservation(location);
    throw error;
  }

  return {
    runId,
    runDirectory: location.directory,
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
    ...manifest.docs.flatMap((doc, index) => {
      const inline = inlineText(doc);
      const separator = index === 0 ? [] : [""];
      return inline
        ? [...separator, `### ${inline.label}`, "", inline.text]
        : [...separator, `- ${docLabel(doc)}`];
    }),
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
