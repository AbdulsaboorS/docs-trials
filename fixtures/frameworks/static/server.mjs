import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2]);
const index = fileURLToPath(new URL("index.html", import.meta.url));

createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  createReadStream(index).pipe(response);
}).listen(port, "127.0.0.1");
