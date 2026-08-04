// Test fixture. Serves one page whose defects are selected by environment
// variables so a single fixture can exercise every baseline check.
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
};

const body = (script) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sample App</title></head>
  <body>
    <h1>Sample App</h1>
    <script src="/app.js"></script>
  </body>
</html>`;

createServer((request, response) => {
  if (request.url === "/app.js") {
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
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`sample app listening on http://127.0.0.1:${port}\n`);
});
