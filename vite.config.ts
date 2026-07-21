import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const smokeStarterFiles = [
  "README.md",
  "index.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "src/App.jsx",
  "src/main.jsx",
  "src/styles.css",
  "vite.config.js",
];

export default defineConfig({
  root: "ui",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-smoke-starter",
      apply: "build",
      async writeBundle() {
        for (const file of smokeStarterFiles) {
          const destination = resolve("dist", "_starters", "updates-filter-starter-v1", file);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(resolve("fixtures", "updates-filter-starter", file), destination);
        }
      },
    },
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
