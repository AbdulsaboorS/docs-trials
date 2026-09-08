import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { init } from "../src/commands/init";
import { manifestSchema } from "../src/core/manifest";

let directory: string;
const socketErrorSchema = z.object({ code: z.string() });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "docs-trials-init-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("init", () => {
  it("uses one selected loopback port for the start command and URL", async () => {
    const path = join(directory, "trial.json");

    await init({ path, workspace: directory }, { availablePort: async () => 43_217 });

    const manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
    expect(manifest.run.start).toBe("npm run dev -- --port 43217");
    expect(manifest.run.url).toBe("http://localhost:43217");
  });

  it("selects and releases an available loopback port", async () => {
    const path = join(directory, "trial.json");

    await init({ path, workspace: directory });

    const manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const port = Number(new URL(manifest.run.url).port);
    expect(manifest.run.start).toContain(`--port ${port}`);
    await expect(listenOnBothFamilies(port)).resolves.toBeUndefined();
  });

  it("does not write a manifest when port selection fails", async () => {
    const path = join(directory, "trial.json");

    await expect(
      init(
        { path, workspace: directory },
        {
          availablePort: async () => {
            throw new Error("No port available.");
          },
        },
      ),
    ).rejects.toThrow("No port available.");
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});

async function listenOnBothFamilies(port: number): Promise<void> {
  const ipv4 = createServer();
  await new Promise<void>((resolveListen, reject) => {
    ipv4.once("error", reject);
    ipv4.listen(port, "127.0.0.1", resolveListen);
  });
  try {
    const ipv6 = createServer();
    try {
      await new Promise<void>((resolveListen, reject) => {
        ipv6.once("error", reject);
        ipv6.listen(port, "::1", resolveListen);
      });
      await new Promise<void>((resolveClose, reject) => {
        ipv6.close((error) => (error ? reject(error) : resolveClose()));
      });
    } catch (cause) {
      const error = socketErrorSchema.safeParse(cause);
      if (!error.success || !["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.data.code)) {
        throw cause;
      }
    }
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      ipv4.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
}
