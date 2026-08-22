// Test fixture. Serves one page whose defects are selected by environment
// variables so a single fixture can exercise every baseline check.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 5173);
const mode = process.env.SAMPLE_MODE ?? "clean";

// Assembled at runtime so no literal credential pattern is stored in Git.
// Secret scanners flag the joined form, which is exactly what makes it a
// useful fixture for the client-secrets check.
const fakeCredential = ["sk", "live", "51ABCDEFGHIJKLMNOPQRSTUVWX"].join("_");

const scripts = {
  clean: "console.log('ready');",
  leak: `const key = '${fakeCredential}'; console.log(key.length);`,
  error: "throw new Error('deliberate fixture failure');",
  egress: "fetch('https://example.com/telemetry').catch(() => {});",
  "fetch-404": "fetch('/optional').catch(() => {});",
  "fetch-flood":
    "for (let index = 0; index < 70; index += 1) fetch('/optional?id=' + index).catch(() => {});",
  "correlated-console-error":
    "fetch('/optional').finally(() => console.error('net::ERR_FAILED ' + location.origin + '/optional'));",
  "json-secret": "fetch('/config.json').then((response) => response.json()).catch(() => {});",
  "incomplete-body": "fetch('/stream').catch(() => {});",
  "finding-plus-gap": `const key = '${fakeCredential}'; fetch('/stream').catch(() => {}); console.log(key.length);`,
  "delayed-error": "setTimeout(() => { throw new Error('delayed fixture failure'); }, 2500);",
  "late-secret": "setTimeout(() => fetch('/late-secret').catch(() => {}), 500);",
  "console-resource-words": "console.error('Failed to load resource: application state corrupt');",
  "console-browser-message":
    "console.error('Failed to load resource: the server responded with a status of 404');",
  "console-cors-words": "console.error('has been blocked by CORS policy');",
  "console-flood":
    "for (let index = 0; index < 70; index += 1) console.error('APPLICATION_ERROR_' + index); setTimeout(() => console.error('LATE_APPLICATION_ERROR'), 300);",
  "large-secret": `/* ${fakeCredential} ${"x".repeat(1_100_000)} */ console.log('ready');`,
  "utf-16-secret": "fetch('/utf-16-secret').catch(() => {});",
  "unsupported-text-encoding": "fetch('/unsupported-text').catch(() => {});",
  "invalid-text-encoding": "fetch('/invalid-text').catch(() => {});",
  websocket: `new WebSocket(${JSON.stringify(process.env.WS_URL ?? "")});`,
  "websocket-same-authority": "new WebSocket('ws://' + location.host + '/socket');",
  "finding-plus-websocket": `const key = '${fakeCredential}'; new WebSocket('ws://' + location.host + '/socket'); console.log(key.length);`,
};

const visibleBody =
  {
    blank: "",
    visual: '<canvas width="40" height="40"></canvas>',
    "empty-canvas": '<canvas width="40" height="40"></canvas>',
    "empty-svg": '<svg width="40" height="40"></svg>',
    "transparent-svg":
      '<svg width="40" height="40"><rect width="40" height="40" fill="transparent" /></svg>',
    "stylesheet-transparent-svg":
      '<svg class="hidden-paint" width="40" height="40"><rect width="40" height="40" /></svg>',
    "transparent-image":
      '<img width="40" height="40" alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3C/svg%3E" />',
    clipped: '<div style="height:0;overflow:hidden"><h1>Clipped text</h1></div>',
    offscreen: '<h1 style="position:absolute;left:-10000px">Sample App</h1>',
    transparent: '<div style="opacity:0"><h1>Sample App</h1></div>',
    "transparent-color": '<h1 style="color:transparent">Sample App</h1>',
    "clip-path": '<button style="clip-path:inset(100%)">Clipped control</button>',
    "masked-control":
      '<button style="mask-image:linear-gradient(transparent,transparent)">Masked control</button>',
    "transparent-control":
      '<button style="appearance:none;background:transparent;border:0;color:transparent;outline:0">Transparent control</button>',
  }[mode] ?? "<h1>Sample App</h1>";

const body = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" /><title>Sample App</title>
    ${mode === "css-secret" ? '<link rel="stylesheet" href="/secret.css" />' : ""}
    ${mode === "missing-style" ? '<link rel="stylesheet" href="/missing.css" />' : ""}
    ${mode === "missing-manifest" ? '<link rel="manifest" href="/missing.webmanifest" />' : ""}
    ${mode === "missing-font" ? '<style>@font-face { font-family: Missing; src: url("/missing.woff2"); } h1 { font-family: Missing; }</style>' : ""}
    ${mode === "stylesheet-transparent-svg" ? "<style>.hidden-paint rect { fill: transparent; }</style>" : ""}
  </head>
  <body>
    ${visibleBody}
    ${mode === "visual" ? '<script>const context = document.querySelector("canvas").getContext("2d"); context.fillStyle = "red"; context.fillRect(0, 0, 40, 40);</script>' : ""}
    ${mode === "blank" || mode === "visual" ? "" : '<script src="/app.js"></script>'}
    ${mode === "hanging-asset" ? '<img src="/hang.png" alt="" />' : ""}
    ${mode === "missing-image" ? '<img src="/missing.png" alt="missing" />' : ""}
    ${mode === "missing-media" ? '<video src="/missing.mp4" autoplay></video>' : ""}
    ${mode === "missing-texttrack" ? '<video><track src="/missing.vtt" default /></video>' : ""}
    ${mode === "missing-frame" ? '<iframe src="/missing-frame"></iframe>' : ""}
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.url === "/hang.png" || request.url?.startsWith("/stream")) {
    if (request.url.startsWith("/stream")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"partial":');
    }
    return;
  }
  if (request.url?.startsWith("/optional")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"optional":false}');
    return;
  }
  if (request.url === "/config.json") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ key: fakeCredential }));
    return;
  }
  if (request.url === "/late-secret") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ key: fakeCredential }));
    }, 1_000);
    return;
  }
  if (request.url === "/secret.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end(`/* ${fakeCredential} */ body { color: black; }`);
    return;
  }
  if (request.url === "/utf-16-secret") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-16le" });
    response.end(Buffer.from(fakeCredential, "utf16le"));
    return;
  }
  if (request.url === "/unsupported-text") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=docs-trials-unsupported",
    });
    response.end("ordinary text");
    return;
  }
  if (request.url === "/invalid-text") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(Buffer.from([0xc3, 0x28]));
    return;
  }
  if (request.url?.startsWith("/missing.") || request.url === "/missing-frame") {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
    return;
  }
  if (request.url === "/app.js") {
    if (mode === "redirected-asset") {
      response.writeHead(302, { location: process.env.REDIRECT_URL ?? "/missing.js" });
      response.end();
      return;
    }
    if (mode === "missing-asset") {
      response.writeHead(404, { "content-type": "text/javascript" });
      response.end("missing");
      return;
    }
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(scripts[mode] ?? scripts.clean);
    return;
  }
  if (mode === "server-error") {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("deliberate fixture server error");
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(body());
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`sample app listening on http://127.0.0.1:${port}\n`);
});
