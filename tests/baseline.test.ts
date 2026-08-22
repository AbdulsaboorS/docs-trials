import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { runBaseline } from "../src/checks";
import { startPreview } from "../src/checks/preview";
import { manifestSchema, type Manifest } from "../src/core/manifest";
import { checkIds, deriveOutcome, type CheckId, type CheckResult } from "../src/core/outcome";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-app");

function manifestAtPort(
  mode: string,
  port: number,
  overrides: Partial<Pick<Manifest, "allowedOrigins">> = {},
  webSocketUrl?: string,
): Manifest {
  return manifestSchema.parse({
    version: 1,
    id: "sample",
    title: "Sample app",
    task: "Serve a page.",
    docs: ["https://example.com/docs"],
    run: {
      install: 'node -e "process.exit(0)"',
      start: `${webSocketUrl ? `WS_URL=${webSocketUrl} ` : ""}SAMPLE_MODE=${mode} PORT=${port} node server.mjs`,
      url: `http://127.0.0.1:${port}`,
      startupTimeoutSeconds: 20,
      commandTimeoutSeconds: 60,
      observationWindowSeconds: 1,
    },
    ...overrides,
  });
}

async function manifest(
  mode: string,
  overrides: Partial<Pick<Manifest, "allowedOrigins">> = {},
  webSocketUrl?: string,
): Promise<Manifest> {
  return manifestAtPort(mode, await availablePort(), overrides, webSocketUrl);
}

function outcomeOf(results: CheckResult[], id: CheckId) {
  return results.find((entry) => entry.id === id)?.outcome;
}

async function availablePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = assignedPort(server);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startWebSocketServer(): Promise<{
  origin: string;
  url: string;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Duplex>();
  const server = createServer((_, response) => {
    response.writeHead(426).end();
  });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = assignedPort(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    url: `ws://127.0.0.1:${port}/socket`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function assignedPort(server: { address(): AddressInfo | string | null }): number {
  // SAFETY: These servers listen with a host and a numeric port, which returns AddressInfo.
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error("No loopback port assigned.");
  return address.port;
}

describe("runBaseline", { timeout: 120_000 }, () => {
  it("passes a clean application", async () => {
    const { results, omittedChecks } = await runBaseline(await manifest("clean"), fixture);
    expect(outcomeOf(results, "install")).toBe("passed");
    expect(outcomeOf(results, "boot")).toBe("passed");
    expect(outcomeOf(results, "page-load")).toBe("passed");
    expect(outcomeOf(results, "visible-content")).toBe("passed");
    expect(outcomeOf(results, "console-errors")).toBe("passed");
    expect(outcomeOf(results, "resource-loads")).toBe("passed");
    expect(outcomeOf(results, "server-errors")).toBe("passed");
    expect(outcomeOf(results, "client-secrets")).toBe("passed");
    expect(outcomeOf(results, "network-egress")).toBe("passed");
    expect(outcomeOf(results, "build")).toBeUndefined();
    expect(omittedChecks).toEqual([
      { id: "build", reason: "The manifest declares no build command." },
    ]);
    expect(
      deriveOutcome(
        results,
        checkIds.filter((id) => id !== "build"),
      ),
    ).toBe("passed");
  });

  it("passes end to end when a build command is declared", async () => {
    const spec = await manifest("clean");
    const withBuild = { ...spec, run: { ...spec.run, build: 'node -e "process.exit(0)"' } };
    const { results } = await runBaseline(withBuild, fixture);
    expect(deriveOutcome(results)).toBe("passed");
  });

  it("fails when a credential is delivered to the browser", async () => {
    const { results } = await runBaseline(await manifest("leak"), fixture);
    expect(outcomeOf(results, "client-secrets")).toBe("failed");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it("fails on an uncaught browser error", async () => {
    const { results } = await runBaseline(await manifest("error"), fixture);
    expect(outcomeOf(results, "console-errors")).toBe("failed");
    const detail = results.find((entry) => entry.id === "console-errors")?.detail ?? "";
    expect(detail).toContain("deliberate fixture failure");
  });

  it("fails when a required same-origin asset returns 404", async () => {
    const { results } = await runBaseline(await manifest("missing-asset"), fixture);
    expect(outcomeOf(results, "page-load")).toBe("passed");
    expect(outcomeOf(results, "visible-content")).toBe("passed");
    expect(outcomeOf(results, "console-errors")).toBe("passed");
    expect(outcomeOf(results, "resource-loads")).toBe("failed");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it.each([
    "missing-style",
    "missing-image",
    "missing-font",
    "missing-media",
    "missing-texttrack",
    "missing-manifest",
    "missing-frame",
  ])("grades a missing %s browser resource", async (mode) => {
    const { results } = await runBaseline(await manifest(mode), fixture);
    expect(outcomeOf(results, "resource-loads")).toBe("failed");
  });

  it("leaves a same-origin fetch 404 ungraded by resource loads", async () => {
    const { results, evidence, ungradedObservations } = await runBaseline(
      await manifest("fetch-404"),
      fixture,
    );
    expect(outcomeOf(results, "resource-loads")).toBe("passed");
    expect(evidence.find((entry) => entry.id === "browser")?.content).toContain(
      '"ungradedObservations": [',
    );
    expect(evidence.find((entry) => entry.id === "browser")?.content).toContain("404");
    expect(ungradedObservations[0]).toContain("404");
  });

  it("is inconclusive while a required same-origin asset remains pending", async () => {
    const { results } = await runBaseline(await manifest("hanging-asset"), fixture);
    expect(outcomeOf(results, "resource-loads")).toBe("inconclusive");
  });

  it.each(["css-secret", "json-secret", "large-secret"])(
    "fails when %s delivers a credential",
    async (mode) => {
      const { results } = await runBaseline(await manifest(mode), fixture);
      expect(outcomeOf(results, "client-secrets")).toBe("failed");
    },
  );

  it("is inconclusive when a same-origin response body remains incomplete", async () => {
    const { results } = await runBaseline(await manifest("incomplete-body"), fixture);
    expect(outcomeOf(results, "client-secrets")).toBe("inconclusive");
  });

  it("is inconclusive when response headers arrive after the observation cutoff", async () => {
    const { results } = await runBaseline(await manifest("late-secret"), fixture);
    expect(outcomeOf(results, "client-secrets")).toBe("inconclusive");
  });

  it("fails a blank structural page and passes a non-text visual surface", async () => {
    const blank = await runBaseline(await manifest("blank"), fixture);
    expect(outcomeOf(blank.results, "visible-content")).toBe("failed");

    const visual = await runBaseline(await manifest("visual"), fixture);
    expect(outcomeOf(visual.results, "visible-content")).toBe("passed");
  });

  it.each(["offscreen", "transparent", "transparent-color"])(
    "fails %s-only content",
    async (mode) => {
      const { results } = await runBaseline(await manifest(mode), fixture);
      expect(outcomeOf(results, "visible-content")).toBe("failed");
    },
  );

  it.each(["clipped", "empty-canvas", "empty-svg", "transparent-svg", "transparent-image"])(
    "fails %s-only content",
    async (mode) => {
      const { results } = await runBaseline(await manifest(mode), fixture);
      expect(outcomeOf(results, "visible-content")).toBe("failed");
    },
  );

  it.each(["console-resource-words", "console-browser-message", "console-cors-words"])(
    "does not discard the %s application console error",
    async (mode) => {
      const { results } = await runBaseline(await manifest(mode), fixture);
      expect(outcomeOf(results, "console-errors")).toBe("failed");
    },
  );

  it("keeps a network-generated console complaint out of application errors", async () => {
    const { results } = await runBaseline(await manifest("missing-asset"), fixture);
    expect(outcomeOf(results, "console-errors")).toBe("passed");
  });

  it("cannot pass after console evidence reaches its retention limit", async () => {
    const { results, evidence } = await runBaseline(await manifest("console-flood"), fixture);
    expect(outcomeOf(results, "console-errors")).not.toBe("passed");
    expect(evidence.find((entry) => entry.id === "browser")?.content).toMatch(
      /"droppedConsoleErrors": [1-9]/,
    );
  });

  it("observes an application error raised after network idle", async () => {
    const spec = await manifest("delayed-error");
    const delayed = {
      ...spec,
      run: { ...spec.run, observationWindowSeconds: 3 },
    };
    const { results } = await runBaseline(delayed, fixture);
    expect(outcomeOf(results, "console-errors")).toBe("failed");
    expect(results.find((entry) => entry.id === "console-errors")?.detail).toContain(
      "delayed fixture failure",
    );
  });

  it("fails on a 5xx response", async () => {
    const { results } = await runBaseline(await manifest("server-error"), fixture);
    expect(outcomeOf(results, "server-errors")).toBe("failed");
    expect(outcomeOf(results, "page-load")).toBe("failed");
  });

  it("is inconclusive about undeclared egress and passes when declared", async () => {
    const undeclared = await runBaseline(await manifest("egress"), fixture);
    expect(outcomeOf(undeclared.results, "network-egress")).toBe("inconclusive");
    expect(deriveOutcome(undeclared.results)).toBe("inconclusive");
    // A blocked or unreachable external request is a network condition. It must
    // not be reported as an application error as well.
    expect(outcomeOf(undeclared.results, "console-errors")).toBe("passed");

    const declared = await runBaseline(
      await manifest("egress", { allowedOrigins: ["https://example.com"] }),
      fixture,
    );
    expect(outcomeOf(declared.results, "network-egress")).toBe("passed");
  });

  it("fails egress that falls outside a declared allowlist", async () => {
    const { results } = await runBaseline(
      await manifest("egress", { allowedOrigins: ["https://api.stripe.com"] }),
      fixture,
    );
    expect(outcomeOf(results, "network-egress")).toBe("failed");
  });

  it("observes undeclared WebSocket egress as a normalized origin", async () => {
    const target = await startWebSocketServer();
    try {
      const run = await runBaseline(await manifest("websocket", {}, target.url), fixture);
      expect(outcomeOf(run.results, "network-egress")).toBe("inconclusive");
      const browserEvidence = run.evidence.find((entry) => entry.id === "browser")?.content ?? "";
      expect(browserEvidence).toContain(target.origin);
      expect(browserEvidence).not.toContain(`ws://127.0.0.1:${new URL(target.url).port}`);
    } finally {
      await target.close();
    }
  });

  it("fails WebSocket egress outside a declared allowlist", async () => {
    const target = await startWebSocketServer();
    try {
      const run = await runBaseline(
        await manifest("websocket", { allowedOrigins: ["https://api.stripe.com"] }, target.url),
        fixture,
      );
      expect(outcomeOf(run.results, "network-egress")).toBe("failed");
    } finally {
      await target.close();
    }
  });

  it.each(["normalized HTTP origin", "WebSocket URL"])(
    "passes WebSocket egress declared with its %s",
    async (declaredForm) => {
      const target = await startWebSocketServer();
      try {
        const run = await runBaseline(
          await manifest(
            "websocket",
            { allowedOrigins: [declaredForm === "WebSocket URL" ? target.url : target.origin] },
            target.url,
          ),
          fixture,
        );
        expect(outcomeOf(run.results, "network-egress")).toBe("passed");
      } finally {
        await target.close();
      }
    },
  );

  it("treats a same-authority WebSocket as same-origin", async () => {
    const run = await runBaseline(await manifest("websocket-same-authority"), fixture);
    expect(outcomeOf(run.results, "network-egress")).toBe("passed");
    const browserEvidence = run.evidence.find((entry) => entry.id === "browser")?.content ?? "";
    expect(browserEvidence).toContain('"externalOrigins": []');
  });

  it("fails the build and marks everything downstream inconclusive", async () => {
    const spec = await manifest("clean");
    const failing = { ...spec, run: { ...spec.run, build: 'node -e "process.exit(3)"' } };
    const { results } = await runBaseline(failing, fixture);
    expect(outcomeOf(results, "build")).toBe("failed");
    expect(outcomeOf(results, "boot")).toBe("inconclusive");
    expect(outcomeOf(results, "page-load")).toBe("inconclusive");
    expect(deriveOutcome(results)).toBe("failed");
  });

  it("reports a busy port as inconclusive, never as an application failure", async () => {
    const blocker = createServer((_, response) => response.end("busy")).listen(0, "127.0.0.1");
    await new Promise((done) => blocker.once("listening", done));
    const port = assignedPort(blocker);
    try {
      const { results } = await runBaseline(manifestAtPort("clean", port), fixture);
      expect(outcomeOf(results, "boot")).toBe("inconclusive");
      expect(deriveOutcome(results)).toBe("inconclusive");
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  it("reports a non-HTTP busy port as inconclusive", async () => {
    const blocker = createTcpServer(() => {}).listen(0, "127.0.0.1");
    await new Promise((done) => blocker.once("listening", done));
    const port = assignedPort(blocker);
    try {
      const { results } = await runBaseline(manifestAtPort("clean", port), fixture);
      expect(outcomeOf(results, "boot")).toBe("inconclusive");
      expect(deriveOutcome(results)).toBe("inconclusive");
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  it("rejects an unrelated server that claims the port after preflight", async () => {
    const port = await availablePort();
    const previewPromise = startPreview(
      'node -e "setTimeout(() => {}, 10000)"',
      fixture,
      `http://127.0.0.1:${port}`,
      10,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    const foreign = createServer((_, response) => response.end("unrelated")).listen(
      port,
      "127.0.0.1",
    );
    await new Promise((done) => foreign.once("listening", done));
    const preview = await previewPromise;
    try {
      expect(preview.available).toBe(false);
      if (preview.available) throw new Error("Expected foreign preview ownership to be rejected.");
      expect(preview.reason).toBe("infrastructure");
      expect(preview.detail).toMatch(/does not belong|could not establish/);
    } finally {
      await preview.stop();
      await new Promise((done) => foreign.close(done));
    }
  });

  it("detects listener ownership that changes after boot", async () => {
    const port = await availablePort();
    const command = `node -e "const http=require('node:http');const server=http.createServer((_,response)=>response.end('owned')).listen(${port},'127.0.0.1');setTimeout(()=>server.close(),500);setInterval(()=>{},1000)"`;
    const preview = await startPreview(command, fixture, `http://127.0.0.1:${port}`, 10);
    expect(preview.available).toBe(true);
    if (!preview.available) throw new Error("Expected the owned preview to start.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    const foreign = createServer((_, response) => response.end("foreign")).listen(
      port,
      "127.0.0.1",
    );
    await new Promise((done) => foreign.once("listening", done));
    try {
      await expect(preview.confirmOwnership()).resolves.toBe(false);
    } finally {
      await preview.stop();
      await new Promise((done) => foreign.close(done));
    }
  });

  it("reports command timeouts and shell exit 127 as inconclusive", async () => {
    const timed = await manifest("clean");
    const timeout = {
      ...timed,
      run: {
        ...timed.run,
        install: 'node -e "setTimeout(() => {}, 2000)"',
        commandTimeoutSeconds: 1,
      },
    };
    expect(outcomeOf((await runBaseline(timeout, fixture)).results, "install")).toBe(
      "inconclusive",
    );

    const unavailable = await manifest("clean");
    const missing = {
      ...unavailable,
      run: { ...unavailable.run, install: "command-that-does-not-exist-docs-trials" },
    };
    expect(outcomeOf((await runBaseline(missing, fixture)).results, "install")).toBe(
      "inconclusive",
    );
  });

  it("reports a missing start executable as inconclusive", async () => {
    const spec = await manifest("clean");
    const missing = {
      ...spec,
      run: { ...spec.run, start: "command-that-does-not-exist-docs-trials" },
    };
    expect(outcomeOf((await runBaseline(missing, fixture)).results, "boot")).toBe("inconclusive");
  });

  it("marks boot as failed when the start command exits immediately", async () => {
    const spec = await manifest("clean");
    const broken = { ...spec, run: { ...spec.run, start: 'node -e "process.exit(1)"' } };
    const { results } = await runBaseline(broken, fixture);
    expect(outcomeOf(results, "boot")).toBe("failed");
  });

  it("records evidence for every stage it reached", async () => {
    const { evidence } = await runBaseline(await manifest("clean"), fixture);
    expect(evidence.map((item) => item.id)).toEqual(["install", "boot", "browser"]);
  });
});
