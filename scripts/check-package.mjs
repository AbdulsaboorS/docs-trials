import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { env, pid, stdout } from "node:process";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "docs-trials-package-"));
let stagedReleasePath;
const npmEnvironment = { ...env };
delete npmEnvironment.npm_config_dry_run;
delete npmEnvironment.NPM_CONFIG_DRY_RUN;

const packedPackagesSchema = z.array(
  z.object({
    filename: z.string(),
    files: z.array(z.object({ path: z.string() })),
    name: z.string(),
    version: z.string(),
  }),
);

try {
  await exec("pnpm", ["build"], { env: npmEnvironment });
  const { stdout: packOutput } = await exec(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory],
    { env: npmEnvironment },
  );
  const [packed] = packedPackagesSchema.parse(JSON.parse(packOutput));
  if (!packed) throw new Error("npm pack returned no package metadata.");

  const expectedFiles = ["LICENSE", "README.md", "dist/cli.js", "dist/cli.js.map", "package.json"];
  const actualFiles = packed.files.map((file) => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected package files: ${actualFiles.join(", ")}`);
  }

  const packagePath = join(temporaryDirectory, packed.filename);
  const installDirectory = join(temporaryDirectory, "install");
  await exec("npm", ["install", "--prefix", installDirectory, "--ignore-scripts", packagePath], {
    env: npmEnvironment,
  });
  const binary = join(installDirectory, "node_modules", ".bin", "docs-trials");
  const { stdout: help } = await exec(binary, ["--help"]);
  if (!help.includes("docs-trials") || !help.includes("verify")) {
    throw new Error("The packed CLI did not print the expected help output.");
  }
  await exec(binary, ["install-browser"], { env: npmEnvironment, timeout: 900_000 });

  const packageJson = JSON.parse(
    await readFile(join(installDirectory, "node_modules", "docs-trials", "package.json"), "utf8"),
  );
  if (packageJson.version !== packed.version)
    throw new Error("Installed package version mismatch.");
  const releaseDirectory = resolve("release");
  await mkdir(releaseDirectory, { recursive: true });
  const releasePath = join(releaseDirectory, packed.filename);
  stagedReleasePath = `${releasePath}.${pid}.tmp`;
  await copyFile(packagePath, stagedReleasePath);
  await rename(stagedReleasePath, releasePath);
  stagedReleasePath = undefined;
  stdout.write(
    [
      `Packed and installed ${packed.name}@${packed.version} with ${actualFiles.length} files.`,
      `Checked release artifact: ${releasePath}`,
      "",
    ].join("\n"),
  );
} finally {
  if (stagedReleasePath) await rm(stagedReleasePath, { force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
