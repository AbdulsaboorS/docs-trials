import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import { builtInStarterManifests } from "./src/starter-assets";

export default defineConfig({
  root: "ui",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-built-in-starters",
      apply: "build",
      async writeBundle() {
        for (const starter of Object.values(builtInStarterManifests)) {
          for (const file of starter.files) {
            const destination = resolve("dist", "_starters", starter.assetDirectory, file);
            await mkdir(dirname(destination), { recursive: true });
            await copyFile(resolve(starter.sourceDirectory, file), destination);
          }
        }
      },
    },
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
