import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const run = process.argv[2];
if (!run) throw new Error("Usage: pnpm trial:local:view -- <run-directory>");
const runDirectory = resolve(run);
const files = new Map([
  ["/", "AX.md"],
  ["/AX.md", "AX.md"],
  ["/report.json", "report.json"],
  ["/grader-results.json", "grader-results.json"],
  ["/evidence.json", "evidence.json"],
]);

const server = createServer(async (request, response) => {
  const file = files.get(new URL(request.url ?? "/", "http://localhost").pathname);
  if (!file) return response.writeHead(404).end("Not found");
  const content = await readFile(resolve(runDirectory, file), "utf8");
  if (file === "AX.md" && request.url === "/") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    return response.end(
      `<!doctype html><title>Docs Trials local report</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;font:16px/1.55 system-ui;background:#f4f3ec;color:#15201d}pre{white-space:pre-wrap;background:#fff;padding:24px;border:1px solid #cfd8d0}a{color:#d95022;margin-right:16px}</style><h1>Docs Trials local report</h1><p>Private local run: ${basename(runDirectory)}</p><p><a href="/AX.md" download>Download AX.md</a><a href="/report.json" download>Download report JSON</a><a href="/evidence.json" download>Download evidence</a></p><pre>${escapeHtml(content)}</pre>`,
    );
  }
  response.setHeader(
    "content-type",
    file === "AX.md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
  );
  response.setHeader("content-disposition", `attachment; filename=${file}`);
  return response.end(content);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address === "object" && address) {
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`Local report: ${url}`);
    openBrowser(url);
  }
});

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ??
      character,
  );
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const browser = spawn(command, args, { detached: true, stdio: "ignore" });
  browser.unref();
}
