import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { browserInstallArguments, resolvePlaywrightCli } from "../src/browser";

const exec = promisify(execFile);

describe("browserInstallArguments", () => {
  it("installs Chromium and its system dependencies on Linux", () => {
    expect(browserInstallArguments("/playwright/cli.js", "linux")).toEqual([
      "/playwright/cli.js",
      "install",
      "--with-deps",
      "chromium",
    ]);
  });

  it("installs only Chromium on macOS", () => {
    expect(browserInstallArguments("/playwright/cli.js", "darwin")).toEqual([
      "/playwright/cli.js",
      "install",
      "chromium",
    ]);
  });

  it("resolves the installed Playwright CLI", async () => {
    const playwrightCli = resolvePlaywrightCli();
    expect(playwrightCli.endsWith("/playwright/cli.js")).toBe(true);
    await expect(access(playwrightCli)).resolves.toBeUndefined();
    await expect(exec(process.execPath, [playwrightCli, "--version"])).resolves.toMatchObject({
      stdout: expect.stringContaining("Version"),
    });
  });
});
