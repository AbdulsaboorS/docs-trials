import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { realtimekitTrial } from "../src/fixture";
import { runLocalTrial } from "../src/local-runner";

const outputRoot = join(process.cwd(), "trial-output");
const result = runLocalTrial(realtimekitTrial);
const outputDir = join(outputRoot, result.run.id);

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "trial.json"), JSON.stringify(result.trial, null, 2));
await writeFile(
  join(outputDir, "agent-trace.jsonl"),
  `${JSON.stringify({ type: "mock-agent", message: "Local deterministic executor" })}\n`,
);
await writeFile(
  join(outputDir, "commands.jsonl"),
  result.run.events
    .filter((event) => event.type === "completed")
    .map((event) => JSON.stringify(event))
    .join("\n")
    .concat("\n"),
);
await mkdir(join(outputDir, "generated-source"), { recursive: true });
await writeFile(
  join(outputDir, "generated-source", "README.md"),
  "Local deterministic fixture workspace.\n",
);
await mkdir(join(outputDir, "browser-evidence"), { recursive: true });
await writeFile(
  join(outputDir, "browser-evidence", "summary.json"),
  JSON.stringify(result.run.evidence),
);
await writeFile(
  join(outputDir, "grader-results.json"),
  JSON.stringify(result.run.graderResults, null, 2),
);
await writeFile(join(outputDir, "AX.md"), result.report.markdown);

console.log(JSON.stringify({ runId: result.run.id, outcome: result.report.outcome, outputDir }));
