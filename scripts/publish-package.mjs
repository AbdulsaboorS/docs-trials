import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, env } from "node:process";
import { z } from "zod";

const [option] = argv.slice(2);
if (option === "--reject-direct") {
  throw new Error("Direct npm publication is disabled. Use `pnpm release:publish`.");
}
if (option !== undefined && option !== "--dry-run") {
  throw new Error(`Unknown publish option: ${option}`);
}

const packageSchema = z.object({ name: z.string().min(1), version: z.string().min(1) });
const packageJson = packageSchema.parse(JSON.parse(await readFile("package.json", "utf8")));
await run("pnpm", ["release:pack"]);

const archiveName = `${packageJson.name.replace(/^@/, "").replaceAll("/", "-")}-${packageJson.version}.tgz`;
const archivePath = resolve("release", archiveName);
await access(archivePath);

await run(
  "npm",
  ["publish", archivePath, "--ignore-scripts", ...(option === "--dry-run" ? ["--dry-run"] : [])],
  env,
);

function run(command, arguments_, environment = env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped with signal ${signal}.`));
      } else if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}
