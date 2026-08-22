import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepare, type PrepareDependencies } from "../src/commands/prepare";
import {
  captureDocumentation,
  documentationTimeoutMs,
  maximumDocumentationBytes,
} from "../src/core/documentation";
import { manifestSchema } from "../src/core/manifest";
import { currentRunMetadata, readRunRecord } from "../src/core/run";

let directory: string;
const retrievedAt = new Date("2026-08-21T12:00:00.000Z");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "docs-trials-prepare-"));
  vi.stubEnv("DOCS_TRIALS_HOME", join(directory, "runs"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("prepare", () => {
  it("freezes inline and retrieved URL documents and points instructions to the copies", async () => {
    const manifestPath = await writeManifest([
      "https://example.com/first",
      { label: "Required notes", text: "Use the v2 client.\nCall initialize() first." },
      { label: "API reference", url: "https://example.com/api" },
    ]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("First reference", "https://docs.example.com/first"))
      .mockResolvedValueOnce(response("API reference body", "https://example.com/api"));

    const prepared = await prepare(
      { manifest: manifestPath, workspace: directory },
      dependencies(fetchMock),
    );
    const record = await readRunRecord(prepared.runId);

    expect(record.documentation).toHaveLength(3);
    expect(record.documentation[0]).toMatchObject({
      status: "frozen",
      sourceUrl: "https://example.com/first",
      finalUrl: "https://docs.example.com/first",
      httpStatus: 200,
      contentType: "text/plain; charset=utf-8",
      retrievedAt: retrievedAt.toISOString(),
      byteLength: 15,
    });
    expect(record).toMatchObject({
      preparation: {
        cliVersion: "0.1.0",
        schemaVersion: 1,
        runtime: { nodeVersion: process.version },
      },
    });
    const frozen = record.documentation.filter((entry) => entry.status === "frozen");
    await expect(readFile(join(prepared.runDirectory, frozen[0]!.file), "utf8")).resolves.toBe(
      "First reference",
    );
    await expect(readFile(join(prepared.runDirectory, frozen[1]!.file), "utf8")).resolves.toBe(
      "Use the v2 client.\nCall initialize() first.",
    );
    expect(prepared.instructions).toContain(
      `Frozen copy (use only this copy): ${join(prepared.runDirectory, frozen[0]!.file)}`,
    );
    expect(prepared.instructions).toContain(
      "Source: https://example.com/first (attribution only; do not use)",
    );
    expect(prepared.instructions).toContain(
      "Final URL: https://docs.example.com/first (attribution only; do not use)",
    );
    expect(prepared.instructions).toContain(
      "For each frozen document, use only its frozen copy. Its URLs are attribution only.",
    );
    expect(prepared.instructions).not.toContain("Use the v2 client.");
    await expect(readFile(prepared.instructionsPath, "utf8")).resolves.toBe(prepared.instructions);
  });

  it("uses a live URL and records incomplete provenance when retrieval is oversized", async () => {
    const manifestPath = await writeManifest(["https://example.com/large"]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maximumDocumentationBytes));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const oversized = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    Object.defineProperty(oversized, "url", { value: "https://example.com/large" });

    const prepared = await prepare(
      { manifest: manifestPath, workspace: directory },
      dependencies(vi.fn<typeof fetch>().mockResolvedValue(oversized)),
    );
    const record = await readRunRecord(prepared.runId);

    expect(record.documentation[0]).toMatchObject({
      status: "live",
      sourceUrl: "https://example.com/large",
      finalUrl: "https://example.com/large",
      httpStatus: 200,
      contentType: "text/plain",
      error: expect.stringContaining("snapshot limit"),
    });
    expect(prepared.instructions).toContain("Live source: https://example.com/large");
    expect(prepared.instructions).toContain("Snapshot incomplete:");
  });

  it("times out retrieval and records the live source", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const pending = captureDocumentation("https://example.com/slow", 0, {
        fetch: fetchMock,
        now: () => retrievedAt,
      });

      await vi.advanceTimersByTimeAsync(documentationTimeoutMs);
      const capture = await pending;

      expect(capture.provenance).toMatchObject({
        status: "live",
        sourceUrl: "https://example.com/slow",
        error: expect.stringContaining("timed out"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["credentials", "https://user:never-store-this-value@docs.example.com/"],
    ["sensitive parameters", "https://docs.example.com/?X-Amz-Signature=never-store-this-value"],
  ])("does not persist or display redirect %s", async (_case, finalUrl) => {
    const manifestPath = await writeManifest(["https://example.com/docs"]);
    const redirected = response("Secret redirect body", finalUrl);

    const prepared = await prepare(
      { manifest: manifestPath, workspace: directory },
      dependencies(vi.fn<typeof fetch>().mockResolvedValue(redirected)),
    );
    const recordText = await readFile(join(prepared.runDirectory, "run.json"), "utf8");

    expect(recordText).not.toContain("never-store-this-value");
    expect(prepared.instructions).not.toContain("never-store-this-value");
    expect(recordText).toContain("sensitive parameters and was not stored");
  });

  it("rejects credential-bearing source URLs before retrieval", async () => {
    const secret = "source-password";
    const manifestPath = await writeManifest([`https://user:${secret}@example.com/docs`]);
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      prepare({ manifest: manifestPath, workspace: directory }, dependencies(fetchMock)),
    ).rejects.toThrow(/must not contain credentials or secrets/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not persist details from a failed retrieval error", async () => {
    const manifestPath = await writeManifest(["https://example.com/docs"]);
    const secret = "redirect-error-secret";

    const prepared = await prepare(
      { manifest: manifestPath, workspace: directory },
      dependencies(vi.fn<typeof fetch>().mockRejectedValue(new Error(secret))),
    );
    const recordText = await readFile(join(prepared.runDirectory, "run.json"), "utf8");

    expect(recordText).not.toContain(secret);
    expect(recordText).toContain("failed before a safe response was available");
  });

  it("rejects oversized inline documentation", async () => {
    const manifestPath = await writeManifest([
      { label: "Too large", text: "x".repeat(maximumDocumentationBytes + 1) },
    ]);

    await expect(
      prepare(
        { manifest: manifestPath, workspace: directory },
        dependencies(vi.fn<typeof fetch>()),
      ),
    ).rejects.toThrow(/inline documentation exceeds/i);
  });

  it("accepts at most the three-digit documentation filename range", () => {
    const base = {
      version: 1,
      id: "doc-count",
      title: "Doc count",
      task: "Build it.",
      run: { start: "node server.mjs" },
    };
    const doc = { label: "Note", text: "Content" };

    expect(() =>
      manifestSchema.parse({ ...base, docs: Array.from({ length: 999 }, () => doc) }),
    ).not.toThrow();
    expect(() =>
      manifestSchema.parse({ ...base, docs: Array.from({ length: 1000 }, () => doc) }),
    ).toThrow();
  });
});

async function writeManifest(docs: unknown[]): Promise<string> {
  const manifestPath = join(directory, "trial.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      id: "frozen-docs",
      title: "Frozen docs",
      task: "Build the integration.",
      docs,
      run: { start: "node server.mjs" },
    }),
  );
  return manifestPath;
}

function dependencies(fetch_: typeof fetch): PrepareDependencies {
  return {
    fetch: fetch_,
    now: () => retrievedAt,
    readBaseline: vi.fn().mockResolvedValue(undefined),
    metadata: currentRunMetadata,
  };
}

function response(body: string, finalUrl: string): Response {
  const value = new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  Object.defineProperty(value, "url", { value: finalUrl });
  return value;
}
