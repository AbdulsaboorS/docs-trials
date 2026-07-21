import type { PlatformEnv } from "./platform-env";
import type { TrialSpec } from "./domain";

export const smokeStarterFiles = [
  "README.md",
  "index.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "src/App.jsx",
  "src/main.jsx",
  "src/styles.css",
  "vite.config.js",
] as const;

export type StarterFile = { path: string; content: string };

export async function loadBuiltInStarter(
  assets: PlatformEnv["ASSETS"],
  spec: TrialSpec,
): Promise<StarterFile[]> {
  if (spec.starterRepository.source !== "builtin:updates-filter-starter-v1") {
    throw new Error(`Unsupported built-in starter: ${spec.starterRepository.source}`);
  }

  return Promise.all(
    smokeStarterFiles.map(async (path) => {
      const response = await assets.fetch(
        new Request(`https://assets.invalid/_starters/updates-filter-starter-v1/${path}`),
      );
      if (!response.ok) throw new Error(`Built-in starter file is unavailable: ${path}`);
      return { path, content: await response.text() };
    }),
  );
}
