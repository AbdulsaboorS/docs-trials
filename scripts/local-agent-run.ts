import { resolve } from "node:path";
import { captureLocalAgentRun, prepareLocalAgentRun } from "../src/local-agent-runner";

const [action, ...rawArgs] = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || value === undefined)
    throw new Error("Expected --name value options.");
  options.set(key.slice(2), value);
}
const manifest = options.get("manifest");
const run = options.get("run");
const workspace = options.get("workspace") ?? process.cwd();

if (action === "prepare" && manifest) {
  console.log(
    JSON.stringify(await prepareLocalAgentRun(resolve(manifest), resolve(workspace)), null, 2),
  );
} else if (action === "capture" && run) {
  console.log(
    JSON.stringify(await captureLocalAgentRun(resolve(run), resolve(workspace)), null, 2),
  );
} else {
  throw new Error(
    "Usage: prepare --manifest <file> [--workspace <dir>] | capture --run <dir> [--workspace <dir>]",
  );
}
