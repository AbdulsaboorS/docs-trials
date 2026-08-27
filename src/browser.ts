import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function browserInstallArguments(
  playwrightCli: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [playwrightCli, "install", ...(platform === "linux" ? ["--with-deps"] : []), "chromium"];
}

export function resolvePlaywrightCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("playwright/package.json")), "cli.js");
}

export async function installBrowser(): Promise<number> {
  const playwrightCli = resolvePlaywrightCli();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, browserInstallArguments(playwrightCli), {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright browser installation stopped with signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
