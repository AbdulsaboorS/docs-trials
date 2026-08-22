import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { observePage } from "../../src/checks/page";
import { trackChild } from "../../src/util/process";

const trackedChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: "ignore",
});
trackChild(trackedChild);

let reportedReady = false;
const server = createServer((_request, response) => {
  if (!reportedReady) {
    reportedReady = true;
    process.stdout.write("READY\n");
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Interrupt probe</title><p>ready</p>");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    process.stderr.write("Fixture could not determine its listening port.\n");
    process.exit(1);
  }

  void observePage(`http://127.0.0.1:${String(address.port)}`, 60, 55)
    .then((observation) => {
      process.stderr.write(
        `Browser observation finished before the interrupt: ${JSON.stringify(observation)}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
});
