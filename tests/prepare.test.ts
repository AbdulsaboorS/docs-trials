import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepare } from "../src/commands/prepare";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "docs-trials-prepare-"));
  vi.stubEnv("DOCS_TRIALS_HOME", join(directory, "runs"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("prepare", () => {
  it("delivers inline documents in order with their complete multiline text", async () => {
    const manifestPath = join(directory, "trial.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        id: "inline-docs",
        title: "Inline docs",
        task: "Build the integration.",
        docs: [
          "https://example.com/first",
          { label: "Required notes", text: "Use the v2 client.\nCall initialize() first." },
          { label: "API reference", url: "https://example.com/api" },
          { label: "Final note", text: "Preserve this final line.\nIncluding this one." },
        ],
        run: { start: "node server.mjs" },
      }),
    );

    const { instructions, instructionsPath } = await prepare({
      manifest: manifestPath,
      workspace: directory,
    });

    expect(instructions).toContain(
      [
        "- https://example.com/first",
        "",
        "### Required notes",
        "",
        "Use the v2 client.",
        "Call initialize() first.",
        "",
        "- API reference: https://example.com/api",
        "",
        "### Final note",
        "",
        "Preserve this final line.",
        "Including this one.",
      ].join("\n"),
    );
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(instructions);
  });
});
