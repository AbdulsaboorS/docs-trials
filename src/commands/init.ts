import { access, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { basename, resolve } from "node:path";
import { z } from "zod";

export type InitOptions = { path: string; workspace: string };
export type InitDependencies = { availablePort: () => Promise<number> };

const defaultDependencies: InitDependencies = { availablePort };
const socketAddressSchema = z.object({ port: z.number().int().min(1).max(65_535) });
const socketErrorSchema = z.object({ code: z.string() });

const template = (id: string, port: number) => ({
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
    start: `npm run dev -- --port ${port}`,
    url: `http://localhost:${port}`,
    observationWindowSeconds: 5,
  },
  allowedOrigins: [],
  allowedEnvironment: [],
  agent: { name: "your coding agent" },
});

export async function init(
  options: InitOptions,
  dependencies: InitDependencies = defaultDependencies,
) {
  const path = resolve(options.path);
  if (await exists(path)) {
    throw new Error(`${path} already exists. Delete it or choose another path.`);
  }
  const id = slug(basename(resolve(options.workspace))) || "trial";
  const port = await dependencies.availablePort();
  await writeFile(path, `${JSON.stringify(template(id, port), null, 2)}\n`);
  return { path };
}

async function availablePort(): Promise<number> {
  try {
    return await reservePort("::");
  } catch (cause) {
    const error = socketErrorSchema.safeParse(cause);
    if (error.success && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.data.code)) {
      return reservePort("127.0.0.1");
    }
    throw cause;
  }
}

async function reservePort(host: string): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen({ host, port: 0, ipv6Only: false }, resolveListen);
    });
    const address = socketAddressSchema.safeParse(server.address());
    if (!address.success) throw new Error("Could not select an available loopback port.");
    return address.data.port;
  } finally {
    if (server.listening) await close(server);
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
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
