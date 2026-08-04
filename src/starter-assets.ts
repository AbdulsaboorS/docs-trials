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

export const aiSearchStarterFiles = [
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "wrangler.jsonc",
  "src/index.ts",
] as const;

export type StarterFile = { path: string; content: string };

export async function loadBuiltInStarter(
  assets: PlatformEnv["ASSETS"],
  spec: TrialSpec,
): Promise<StarterFile[]> {
  const starter = builtInStarterManifests[spec.starterRepository.source];
  if (!starter) {
    throw new Error(`Unsupported built-in starter: ${spec.starterRepository.source}`);
  }

  return Promise.all(
    starter.files.map(async (path) => {
      const response = await assets.fetch(
        new Request(`https://assets.invalid/_starters/${starter.assetDirectory}/${path}`),
      );
      if (!response.ok) throw new Error(`Built-in starter file is unavailable: ${path}`);
      return { path, content: await response.text() };
    }),
  );
}

export const builtInStarterManifests: Record<
  string,
  { assetDirectory: string; sourceDirectory: string; files: readonly string[] }
> = {
  "builtin:updates-filter-starter-v1": {
    assetDirectory: "updates-filter-starter-v1",
    sourceDirectory: "fixtures/updates-filter-starter",
    files: smokeStarterFiles,
  },
  "builtin:ai-search-research-starter-v1": {
    assetDirectory: "ai-search-research-starter-v1",
    sourceDirectory: "fixtures/ai-search-research-starter",
    files: aiSearchStarterFiles,
  },
};
