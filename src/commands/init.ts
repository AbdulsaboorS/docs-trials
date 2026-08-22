import { access, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export type InitOptions = { path: string; workspace: string };

const template = (id: string) => ({
  version: 1,
  id,
  title: "Replace with a short title",
  task: "Replace with the integration you want an agent to build from these docs.",
  docs: ["https://example.com/docs/quickstart"],
  goals: [
    "Replace with what a working result looks like. Docs Trials records these but does not check them.",
  ],
  run: {
    install: "npm install",
    build: "npm run build",
    start: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    observationWindowSeconds: 5,
  },
  allowedOrigins: [],
  agent: { name: "your coding agent" },
});

export async function init(options: InitOptions) {
  const path = resolve(options.path);
  if (await exists(path)) {
    throw new Error(`${path} already exists. Delete it or choose another path.`);
  }
  const id = slug(basename(resolve(options.workspace))) || "trial";
  await writeFile(path, `${JSON.stringify(template(id), null, 2)}\n`);
  return { path };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
