import { describe, expect, it } from "vitest";
import { digestManifest, docLabel, manifestSchema } from "../src/core/manifest";

const base = {
  version: 1,
  id: "sample",
  title: "Sample",
  task: "Build something.",
  docs: ["https://example.com/docs"],
  run: { start: "node server.mjs" },
};

describe("manifestSchema", () => {
  it("applies defaults for the run block", () => {
    const manifest = manifestSchema.parse(base);
    expect(manifest.run.install).toBe("npm install");
    expect(manifest.run.url).toBe("http://127.0.0.1:5173");
    expect(manifest.goals).toEqual([]);
  });

  it("rejects a non-loopback preview URL", () => {
    expect(() =>
      manifestSchema.parse({ ...base, run: { ...base.run, url: "https://example.com" } }),
    ).toThrow(/loopback/);
  });

  it("rejects credentials embedded in the preview URL", () => {
    expect(() =>
      manifestSchema.parse({ ...base, run: { ...base.run, url: "http://a:b@127.0.0.1:5173" } }),
    ).toThrow(/loopback/);
  });

  it("rejects unknown fields", () => {
    expect(() => manifestSchema.parse({ ...base, criteria: ["x"] })).toThrow();
  });

  it("requires at least one document", () => {
    expect(() => manifestSchema.parse({ ...base, docs: [] })).toThrow();
  });

  it("accepts labelled url and inline text documents", () => {
    const manifest = manifestSchema.parse({
      ...base,
      docs: [
        { label: "Quickstart", url: "https://example.com/q" },
        { label: "Notes", text: "Use the v2 client." },
      ],
    });
    expect(manifest.docs).toHaveLength(2);
    expect(docLabel(manifest.docs[1]!)).toBe("Notes (inline text)");
  });
});

describe("digestManifest", () => {
  it("is stable for the same manifest and differs for a changed one", () => {
    const a = manifestSchema.parse(base);
    const b = manifestSchema.parse({ ...base, task: "Build something else." });
    expect(digestManifest(a)).toBe(digestManifest(a));
    expect(digestManifest(a)).not.toBe(digestManifest(b));
  });
});
