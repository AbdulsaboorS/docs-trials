import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runLocalUpdatesFilterVerification,
  type LocalUpdatesFilterVerification,
} from "../src/local-updates-filter-verifier";

const workspace = await mkdtemp(join(tmpdir(), "docs-trials-browser-smoke-"));
const serverPath = join(workspace, "server.mjs");

try {
  await writeFile(serverPath, createServerSource());
  const clean = await runSmokeCase("clean");
  const external = await runSmokeCase("external");
  const cleanOutcome = deriveOutcome(clean);
  const externalTrafficBlocked =
    external.preview.available &&
    (external.observations?.unexpectedExternalRequests.some((url) => url.startsWith("https:")) ??
      false) &&
    (external.observations?.unexpectedExternalRequests.some((url) => url.startsWith("wss:")) ??
      false) &&
    external.browser.results.some(
      (result) => result.criterion.includes("unexpected external") && result.outcome === "failed",
    );
  const outcome =
    cleanOutcome !== "passed"
      ? cleanOutcome
      : external.browser.results.some((result) => result.outcome === "inconclusive")
        ? "inconclusive"
        : externalTrafficBlocked
          ? "passed"
          : "failed";
  console.log(
    JSON.stringify({
      profile: "updates-filter-smoke-v1",
      outcome,
      clean: {
        preview: clean.preview,
        browser: clean.browser.results,
      },
      externalBlocking: {
        preview: external.preview,
        observedRequests: external.observations?.unexpectedExternalRequests ?? [],
        passed: externalTrafficBlocked,
      },
    }),
  );
  if (outcome !== "passed") process.exitCode = 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function runSmokeCase(mode: "clean" | "external") {
  const port = await reservePort();
  const previewUrl = `http://127.0.0.1:${port}`;
  return runLocalUpdatesFilterVerification(
    {
      startCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)} ${port} ${mode}`,
      previewUrl,
      startupTimeoutSeconds: 10,
      browserTimeoutSeconds: 20,
    },
    workspace,
  );
}

function deriveOutcome(verification: LocalUpdatesFilterVerification) {
  if (!verification.preview.available) {
    return verification.preview.failureKind === "application" ? "failed" : "inconclusive";
  }
  if (verification.browser.results.some((result) => result.outcome === "failed")) return "failed";
  if (verification.browser.results.some((result) => result.outcome === "inconclusive")) {
    return "inconclusive";
  }
  return "passed";
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve a loopback port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function createServerSource(): string {
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Updates</title></head>
  <body>
    <main>
      <h1>Updates</h1>
      <nav aria-label="Topics">
        <button>All</button><button>Platform</button><button>Evidence</button><button>Safety</button><button>Archived</button>
      </nav>
      <section id="updates"></section>
    </main>
    <script>
      const updates = [
        { title: "Faster previews", topic: "Platform" },
        { title: "Clearer evidence", topic: "Evidence" },
        { title: "Safer trial limits", topic: "Safety" },
      ];
      const container = document.querySelector("#updates");
      function render(topic = "All") {
        const visible = topic === "All" ? updates : updates.filter((update) => update.topic === topic);
        container.replaceChildren(...(visible.length
          ? visible.map((update) => Object.assign(document.createElement("article"), { textContent: update.title }))
          : [Object.assign(document.createElement("p"), { textContent: "No updates found." })]));
      }
      document.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => render(button.textContent)));
      const localSocket = new WebSocket("ws://" + location.host + "/socket");
      const localSocketTimeout = setTimeout(() => console.error("Local WebSocket did not respond."), 300);
      localSocket.addEventListener("message", (event) => {
        if (event.data === "ready") clearTimeout(localSocketTimeout);
      });
      localSocket.addEventListener("error", () => console.error("Local WebSocket failed."));
      render();
    </script>
  </body>
</html>`;
  return `
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2]);
const mode = process.argv[3];
const externalProbe = mode === "external"
  ? '<script>fetch("https://example.com/docs-trials-probe").catch(() => {}); new WebSocket("wss://example.com/docs-trials-probe");</script>'
  : '';
const html = ${JSON.stringify(html)}.replace('</body>', externalProbe + '</body>');
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
server.on("upgrade", (request, socket) => {
  if (request.url !== "/socket" || !request.headers["sec-websocket-key"]) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\n" +
      "Upgrade: websocket\\r\\n" +
      "Connection: Upgrade\\r\\n" +
      "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
  );
  socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from("ready")]));
});
server.listen(port, "127.0.0.1");
`;
}
