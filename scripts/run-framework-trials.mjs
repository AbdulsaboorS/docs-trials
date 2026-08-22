import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(
  join(process.env.RUNNER_TEMP ?? tmpdir(), "docs-trials-frameworks-"),
);
const workspace = join(temporary, "workspace");
const portReleases = [];
const requestedFixtures = new Set(process.argv.slice(2));

try {
  await cp(join(root, "fixtures", "frameworks"), workspace, { recursive: true });
  const prepared = [];
  const fixtures = [
    { name: "static", install: 'node -e "process.exit(0)"', start: "node server.mjs" },
    {
      name: "vite",
      install: "pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "pnpm exec vite preview --host 127.0.0.1 --strictPort --port",
    },
    {
      name: "astro",
      install: "pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "pnpm exec astro preview --host 127.0.0.1 --port",
    },
    {
      name: "next",
      install: "pnpm install --frozen-lockfile",
      build: "NEXT_TELEMETRY_DISABLED=1 pnpm build",
      start: "NEXT_TELEMETRY_DISABLED=1 pnpm exec next start --hostname 127.0.0.1 --port",
    },
  ];
  for (const requested of requestedFixtures) {
    if (!fixtures.some((fixture) => fixture.name === requested)) {
      throw new Error(`Unknown framework fixture: ${requested}.`);
    }
  }
  for (const fixture of fixtures.filter(
    (candidate) => requestedFixtures.size === 0 || requestedFixtures.has(candidate.name),
  )) {
    const reservation = await reservePort();
    portReleases.push(reservation.release);
    const { port } = reservation;
    const directory = join(workspace, fixture.name);
    const lifecycle = {
      install: fixture.install,
      start: `${fixture.start} ${port}`,
      url: `http://127.0.0.1:${port}`,
      startupTimeoutSeconds: 60,
      commandTimeoutSeconds: 180,
      observationWindowSeconds: 1,
    };
    if (fixture.build) lifecycle.build = fixture.build;
    const manifest = {
      version: 1,
      id: `framework-${fixture.name}`,
      title: `${fixture.name} framework trial`,
      task: "Render the existing fixture application.",
      docs: [{ label: "Fixture instructions", text: "Use the existing application source." }],
      run: lifecycle,
      allowedOrigins: [],
      allowedEnvironment: [],
      agent: { name: "CI framework fixture" },
    };
    const manifestPath = join(directory, "trial.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    prepared.push({ name: fixture.name, directory, manifestPath, release: reservation.release });
  }

  await run("git", ["init", "--quiet"], { cwd: workspace });
  await run("git", ["add", "."], { cwd: workspace });
  await run(
    "git",
    [
      "-c",
      "user.name=Docs Trials",
      "-c",
      "user.email=docs-trials@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "framework fixtures",
    ],
    { cwd: workspace },
  );

  for (const fixture of prepared) {
    await executeTrial(fixture.name, fixture.directory, fixture.manifestPath, fixture.release);
  }
} finally {
  await Promise.allSettled(portReleases.map((release) => release()));
  await rm(temporary, { recursive: true, force: true });
}

async function executeTrial(name, workspaceDirectory, manifestPath, releasePort) {
  const home = join(temporary, "runs", name);
  const environment = { ...process.env, DOCS_TRIALS_HOME: home };
  try {
    await command(
      ["prepare", "--manifest", manifestPath, "--workspace", workspaceDirectory],
      environment,
    );
    await releasePort();
    await command(["verify", "latest", "--quiet"], environment);
  } finally {
    await releasePort();
  }
  process.stdout.write(`Framework trial passed: ${name}\n`);
}

async function command(arguments_, environment) {
  await new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, [join(root, "dist", "cli.js"), ...arguments_], {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolveCommand();
      else reject(new Error(`Docs Trials exited with code ${String(code)} and signal ${signal}.`));
    });
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = address && "port" in address ? address.port : undefined;
  if (!Number.isSafeInteger(port)) throw new Error("Could not allocate a port.");
  let released = false;
  return {
    port,
    release: async () => {
      if (released) return;
      released = true;
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}
