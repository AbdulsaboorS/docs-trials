import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runBaseline } from "../src/checks";
import { manifestSchema, type Manifest } from "../src/core/manifest";
import { deriveOutcome, type CheckId, type CheckResult } from "../src/core/outcome";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-app");

function manifest(mode: string, port: number, overrides: Record<string, unknown> = {}): Manifest {
  return manifestSchema.parse({
    version: 1,
    id: "sample",
    title: "Sample app",
    task: "Serve a page.",
    docs: ["https://example.com/docs"],
    run: {
      install: 'node -e "process.exit(0)"',
      start: `SAMPLE_MODE=${mode} PORT=${port} node server.mjs`,
      url: `http://127.0.0.1:${port}`,
      startupTimeoutSeconds: 20,
      commandTimeoutSeconds: 60,
    },
    ...overrides,
  });
}

function outcomeOf(results: CheckResult[], id: CheckId) {
  return results.find((entry) => entry.id === id)?.outcome;
}

let nextPort = 5410;
const port = () => nextPort++;

describe("runBaseline", { timeout: 120_000 }, () => {
  it("passes a clean application", async () => {
    const { results } = await runBaseline(manifest("clean", port()), fixture);
    expect(outcomeOf(results, "install")).toBe("passed");
    expect(outcomeOf(results, "boot")).toBe("passed");
    expect(outcomeOf(results, "page-load")).toBe("passed");
    expect(outcomeOf(results, "console-errors")).toBe("passed");
    expect(outcomeOf(results, "server-errors")).toBe("passed");
    expect(outcomeOf(results, "client-secrets")).toBe("passed");
    expect(outcomeOf(results, "network-egress")).toBe("passed");
    // No build command declared, so the run cannot be a clean pass.
    expect(outcomeOf(results, "build")).toBe("inconclusive");
    expect(deriveOutcome(results)).toBe("inconclusive");
  });

  it("passes end to end when a build command is declared", async () => {
    const spec = manifest("clean", port());
    const withBuild = { ...spec, run: { ...spec.run, build: 'node -e "process.exit(0)"' } };
    const { results } = await runBaseline(withBuild, fixture);
    expect(deriveOutcome(results)).toBe("passed");
  });

  it("fails when a credential is delivered to the browser", async () => {
    const { results } = await runBaseline(manifest("leak", port()), fixture);
    expect(outcomeOf(results, "client-secrets")).toBe("failed");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it("fails on an uncaught browser error", async () => {
    const { results } = await runBaseline(manifest("error", port()), fixture);
    expect(outcomeOf(results, "console-errors")).toBe("failed");
    const detail = results.find((entry) => entry.id === "console-errors")?.detail ?? "";
    expect(detail).toContain("deliberate fixture failure");
  });

  it("fails on a 5xx response", async () => {
    const { results } = await runBaseline(manifest("server-error", port()), fixture);
    expect(outcomeOf(results, "server-errors")).toBe("failed");
    expect(outcomeOf(results, "page-load")).toBe("failed");
  });

  it("is inconclusive about undeclared egress and passes when declared", async () => {
    const undeclared = await runBaseline(manifest("egress", port()), fixture);
    expect(outcomeOf(undeclared.results, "network-egress")).toBe("inconclusive");
    expect(deriveOutcome(undeclared.results)).toBe("inconclusive");
    // A blocked or unreachable external request is a network condition. It must
    // not be reported as an application error as well.
    expect(outcomeOf(undeclared.results, "console-errors")).toBe("passed");

    const declared = await runBaseline(
      manifest("egress", port(), { allowedOrigins: ["https://example.com"] }),
      fixture,
    );
    expect(outcomeOf(declared.results, "network-egress")).toBe("passed");
  });

  it("fails egress that falls outside a declared allowlist", async () => {
    const { results } = await runBaseline(
      manifest("egress", port(), { allowedOrigins: ["https://api.stripe.com"] }),
      fixture,
    );
    expect(outcomeOf(results, "network-egress")).toBe("failed");
  });

  it("fails the build and marks everything downstream inconclusive", async () => {
    const spec = manifest("clean", port());
    const failing = { ...spec, run: { ...spec.run, build: 'node -e "process.exit(3)"' } };
    const { results } = await runBaseline(failing, fixture);
    expect(outcomeOf(results, "build")).toBe("failed");
    expect(outcomeOf(results, "boot")).toBe("inconclusive");
    expect(outcomeOf(results, "page-load")).toBe("inconclusive");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it("reports a busy port as inconclusive, never as an application failure", async () => {
    const busy = port();
    const blocker = createServer((_, response) => response.end("busy")).listen(busy, "127.0.0.1");
    await new Promise((done) => blocker.once("listening", done));
    try {
      const { results } = await runBaseline(manifest("clean", busy), fixture);
      expect(outcomeOf(results, "boot")).toBe("inconclusive");
      expect(deriveOutcome(results)).toBe("inconclusive");
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  it("marks boot as failed when the start command exits immediately", async () => {
    const spec = manifest("clean", port());
    const broken = { ...spec, run: { ...spec.run, start: 'node -e "process.exit(1)"' } };
    const { results } = await runBaseline(broken, fixture);
    expect(outcomeOf(results, "boot")).toBe("failed");
  });

  it("records evidence for every stage it reached", async () => {
    const { evidence } = await runBaseline(manifest("clean", port()), fixture);
    expect(evidence.map((item) => item.id)).toEqual(["install", "boot", "browser"]);
  });
});
