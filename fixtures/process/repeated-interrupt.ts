import { spawn } from "node:child_process";
import { trackChild } from "../../src/util/process";

const child = spawn(
  process.execPath,
  [
    "-e",
    'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1_000)',
  ],
  {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  },
);

trackChild(child);
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.stdout?.once("data", () => {
  process.stdout.write(`${String(child.pid)}\n`);
});
