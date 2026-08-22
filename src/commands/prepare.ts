import { resolve } from "node:path";
import {
  captureDocumentation,
  type DocumentationProvenance,
  type DocumentationRetrievalDependencies,
} from "../core/documentation";
import { loadManifest, type Manifest } from "../core/manifest";
import {
  currentRunMetadata,
  removeRunReservation,
  reserveRunDirectory,
  writeArtifact,
  writeDocumentationSnapshot,
  writeRunRecord,
  type ExecutionMetadata,
  type RunRecord,
} from "../core/run";
import { readBaseline } from "../util/git";

export type PrepareOptions = { manifest: string; workspace: string };
export type PrepareDependencies = DocumentationRetrievalDependencies & {
  readBaseline: typeof readBaseline;
  metadata: () => ExecutionMetadata;
};

const defaultDependencies: PrepareDependencies = {
  fetch: globalThis.fetch,
  now: () => new Date(),
  readBaseline,
  metadata: currentRunMetadata,
};

export async function prepare(
  options: PrepareOptions,
  dependencies: PrepareDependencies = defaultDependencies,
) {
  const workspace = resolve(options.workspace);
  const { manifest, digest } = await loadManifest(options.manifest);
  const preparedAt = dependencies.now();
  const location = await reserveRunDirectory(manifest.id, preparedAt);
  const { runId } = location;
  try {
    const documentation: DocumentationProvenance[] = [];
    for (const [index, doc] of manifest.docs.entries()) {
      const capture = await captureDocumentation(doc, index, dependencies);
      if (capture.provenance.status === "frozen") {
        if (!capture.content) throw new Error("A frozen documentation capture has no content.");
        await writeDocumentationSnapshot(location, capture.provenance.file, capture.content);
      }
      documentation.push(capture.provenance);
    }
    const baseline = await dependencies.readBaseline(workspace);
    const instructions = renderInstructions(manifest, documentation, location.directory);
    const record: RunRecord = {
      runId,
      status: "prepared",
      manifest,
      manifestDigest: digest,
      workspace,
      preparedAt: preparedAt.toISOString(),
      preparation: dependencies.metadata(),
      documentation,
    };
    if (baseline) record.baselineRevision = baseline.revision;
    const instructionsPath = await writeArtifact(location, "AGENT_INSTRUCTIONS.md", instructions);
    await writeRunRecord(location, record);
    return {
      runId,
      runDirectory: location.directory,
      instructionsPath,
      instructions,
      baseline,
      workspace,
    };
  } catch (error) {
    await removeRunReservation(location);
    throw error;
  }
}

/**
 * The agent receives the task and the assigned documentation. It does not
 * receive the list of baseline checks. Publishing the checks would invite an
 * agent to satisfy the detector instead of building the integration.
 */
function renderInstructions(
  manifest: Manifest,
  documentation: DocumentationProvenance[],
  runDirectory: string,
): string {
  return [
    "# Docs Trials task",
    "",
    "## What to build",
    "",
    manifest.task,
    "",
    "## Documentation you may use",
    "",
    ...documentation.flatMap((doc, index) => {
      const separator = index === 0 ? [] : [""];
      if (doc.status === "live") {
        return [
          ...separator,
          `### ${doc.label}`,
          "",
          `- Live source: ${doc.sourceUrl}`,
          `- Snapshot incomplete: ${doc.error}`,
        ];
      }
      const source =
        doc.sourceType === "inline"
          ? "Inline text from the trial manifest"
          : `${doc.sourceUrl} (attribution only; do not use)`;
      return [
        ...separator,
        `### ${doc.label}`,
        "",
        `- Frozen copy (use only this copy): ${resolve(runDirectory, doc.file)}`,
        `- Source: ${source}`,
        ...(doc.sourceType === "url" && doc.finalUrl !== doc.sourceUrl
          ? [`- Final URL: ${doc.finalUrl} (attribution only; do not use)`]
          : []),
      ];
    }),
    "",
    "## Rules",
    "",
    "- Treat the documentation above as your only source for this product's API.",
    "- For each frozen document, use only its frozen copy. Its URLs are attribution only.",
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
