import { chmod } from "node:fs/promises";
import { build } from "esbuild";

// A single-file bundle keeps CLI startup fast and removes ESM path-resolution
// differences between the source tree and the published package.
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["playwright"],
  logLevel: "info",
});

await chmod("dist/cli.js", 0o755);
