import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Locator, type Page } from "playwright";
import {
  appendBoundedBrowserMessage,
  unavailableBrowserGrade,
  type BrowserGrade,
  type BrowserMessageBudget,
  type SmokePreviewResult,
} from "./controlled-run-results";
import { redact } from "./redact";
import {
  evaluateUpdatesFilterObservations,
  type UpdatesFilterObservations,
} from "./updates-filter-grader";

const maxOutputBytes = 200_000;

export type LocalBrowserConfig = {
  startCommand: string;
  previewUrl: string;
  startupTimeoutSeconds: number;
  browserTimeoutSeconds: number;
};

export type LocalUpdatesFilterVerification = {
  preview: SmokePreviewResult;
  previewOutput: string;
  browser: BrowserGrade;
  observations?: UpdatesFilterObservations;
};

export async function runLocalUpdatesFilterVerification(
  config: LocalBrowserConfig,
  workspace: string,
): Promise<LocalUpdatesFilterVerification> {
  if (await isReachable(config.previewUrl)) {
    const detail = `Preview URL was already reachable before the frozen start command ran: ${config.previewUrl}`;
    return {
      preview: { available: false, detail, failureKind: "infrastructure" },
      previewOutput: detail,
      browser: unavailableBrowserGrade(detail),
    };
  }

  let preview: ChildProcess | undefined;
  const previewOutputChunks: Buffer[] = [];
  let previewOutputBytes = 0;
  const collectedPreviewOutput = () => Buffer.concat(previewOutputChunks).toString("utf8");
  try {
    preview = spawn(config.startCommand, {
      cwd: workspace,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const appendOutput = (chunk: Buffer) => {
      if (previewOutputBytes >= maxOutputBytes) return;
      const bounded = chunk.subarray(0, maxOutputBytes - previewOutputBytes);
      previewOutputChunks.push(bounded);
      previewOutputBytes += bounded.byteLength;
    };
    preview.stdout?.on("data", appendOutput);
    preview.stderr?.on("data", appendOutput);

    const readiness = await waitForPreview(
      preview,
      config.previewUrl,
      config.startupTimeoutSeconds,
    );
    if (!readiness.available) {
      return {
        preview: readiness,
        previewOutput: redact(collectedPreviewOutput() || readiness.detail),
        browser: unavailableBrowserGrade(readiness.detail),
      };
    }

    let browser: BrowserGrade;
    let observations: UpdatesFilterObservations | undefined;
    try {
      const graded = await gradeLocalUpdatesFilterPage(
        config.previewUrl,
        config.browserTimeoutSeconds,
      );
      browser = graded.browser;
      observations = graded.observations;
    } catch (error) {
      browser = unavailableBrowserGrade(
        `Local Playwright could not run: ${redact(error instanceof Error ? error.message : String(error))}`,
      );
    }
    return {
      preview: readiness,
      previewOutput: redact(collectedPreviewOutput()),
      browser,
      ...(observations ? { observations } : {}),
    };
  } catch (error) {
    const detail = `The frozen preview command could not start: ${redact(error instanceof Error ? error.message : String(error))}`;
    return {
      preview: { available: false, detail, failureKind: "infrastructure" },
      previewOutput: redact(collectedPreviewOutput() || detail),
      browser: unavailableBrowserGrade(detail),
    };
  } finally {
    if (preview) await terminateLocalProcessTree(preview);
  }
}

async function gradeLocalUpdatesFilterPage(
  previewUrl: string,
  browserTimeoutSeconds: number,
): Promise<{ browser: BrowserGrade; observations: UpdatesFilterObservations }> {
  const browser = await chromium.launch({ headless: true });
  const consoleMessages: string[] = [];
  const networkFailures: string[] = [];
  const unexpectedExternalRequests: string[] = [];
  const messageBudget: BrowserMessageBudget = { count: 0, bytes: 0 };
  const previewOrigin = new URL(previewUrl).origin;
  const deadline = Date.now() + browserTimeoutSeconds * 1_000;

  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.protocol.startsWith("http") && requestUrl.origin !== previewOrigin) {
        appendBoundedBrowserMessage(
          unexpectedExternalRequests,
          requestUrl.toString(),
          messageBudget,
        );
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await context.routeWebSocket("**/*", (webSocket) => {
      const requestUrl = new URL(webSocket.url());
      if (httpOrigin(requestUrl) !== previewOrigin) {
        appendBoundedBrowserMessage(
          unexpectedExternalRequests,
          requestUrl.toString(),
          messageBudget,
        );
        return;
      }
      webSocket.connectToServer();
    });
    const page = await context.newPage();
    setRemainingBrowserTimeout(page, deadline);
    page.on("pageerror", (error) =>
      appendBoundedBrowserMessage(consoleMessages, error.message, messageBudget),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        appendBoundedBrowserMessage(consoleMessages, message.text(), messageBudget);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 500) {
        appendBoundedBrowserMessage(
          networkFailures,
          `${response.status()} ${response.url()}`,
          messageBudget,
        );
      }
    });
    let navigationSucceeded = true;
    try {
      await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
      await quiesce(page, deadline, 250);
    } catch (error) {
      navigationSucceeded = false;
      appendBoundedBrowserMessage(
        networkFailures,
        error instanceof Error ? error.message : String(error),
        messageBudget,
      );
    }

    setRemainingBrowserTimeout(page, deadline);
    const headingVisible =
      navigationSucceeded &&
      (await isUniqueVisible(page.getByRole("heading", { name: "Updates", exact: true })));
    const updates = page.getByRole("article");
    const initialUpdates = navigationSucceeded
      ? await visibleContents(updates)
      : { count: 0, text: "" };

    await clickUniqueButton(page, "Platform", navigationSucceeded, deadline);
    const platformUpdates = navigationSucceeded
      ? await visibleContents(updates)
      : { count: 0, text: "" };
    await clickUniqueButton(page, "Archived", navigationSucceeded, deadline);
    const emptyMessageVisible =
      navigationSucceeded &&
      (await isUniqueVisible(page.getByText("No updates found.", { exact: true })));
    if (navigationSucceeded) await quiesce(page, deadline, 500);

    const observations = {
      headingVisible,
      initialUpdateCount: initialUpdates.count,
      initialUpdateText: initialUpdates.text,
      platformUpdateCount: platformUpdates.count,
      platformUpdateText: platformUpdates.text,
      emptyMessageVisible,
      consoleMessages,
      networkFailures,
      unexpectedExternalRequests,
    } satisfies UpdatesFilterObservations;
    return {
      observations,
      browser: {
        sessionId: `local-playwright-${browser.version()}`,
        consoleMessages,
        networkFailures,
        unexpectedExternalRequests,
        screenshotCaptured: false,
        results: evaluateUpdatesFilterObservations(observations),
      },
    };
  } finally {
    await browser.close();
  }
}

async function clickUniqueButton(
  page: Page,
  name: string,
  navigationSucceeded: boolean,
  deadline: number,
): Promise<void> {
  if (!navigationSucceeded) return;
  const button = page.getByRole("button", { name, exact: true });
  if (!(await isUniqueVisible(button))) return;
  try {
    setRemainingBrowserTimeout(page, deadline);
    await button.click();
    await quiesce(page, deadline, 250);
  } catch {
    // An unresponsive application control is a deterministic observed failure.
  }
}

async function waitForPreview(
  child: ChildProcess,
  previewUrl: string,
  timeoutSeconds: number,
): Promise<SmokePreviewResult> {
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (spawnError) {
      return {
        available: false,
        detail: `The frozen preview command could not start: ${redact(spawnError.message)}`,
        failureKind: "infrastructure",
      };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return {
        available: false,
        detail: "The frozen preview command exited before the preview became reachable.",
        failureKind: "application",
      };
    }
    if (await isReachable(previewUrl)) {
      return { available: true, processId: String(child.pid ?? "unknown"), url: previewUrl };
    }
    await delay(200);
  }
  return {
    available: false,
    detail: `The preview did not become reachable within ${timeoutSeconds} seconds.`,
    failureKind: "application",
  };
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export async function terminateLocalProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      await new Promise<void>((resolve) => {
        const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        cleanup.once("error", () => resolve());
        cleanup.once("close", () => resolve());
      });
    } catch {
      // The process tree may already be gone.
    }
    return;
  }
  const processGroupExists = () => {
    try {
      process.kill(-child.pid!, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!processGroupExists()) return;
  const signal = (value: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, value);
    } catch {
      // The process may have exited between the state check and signal.
    }
  };
  signal("SIGTERM");
  await delay(500);
  if (processGroupExists()) signal("SIGKILL");
  await delay(100);
  if (processGroupExists()) {
    throw new Error(`Could not confirm cleanup of local process group ${child.pid}.`);
  }
}

function setRemainingBrowserTimeout(page: Page, deadline: number): void {
  page.setDefaultTimeout(Math.max(1, deadline - Date.now()));
}

async function isUniqueVisible(locator: Locator): Promise<boolean> {
  return (await locator.count()) === 1 && locator.isVisible();
}

async function visibleContents(locator: Locator): Promise<{ count: number; text: string }> {
  const values: string[] = [];
  let visibleCount = 0;
  const total = await locator.count();
  const inspected = Math.min(total, 100);
  for (let index = 0; index < inspected; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) {
      visibleCount += 1;
      values.push(await item.evaluate((element) => (element.textContent ?? "").slice(0, 500)));
    }
  }
  return { count: total > inspected ? inspected + 1 : visibleCount, text: values.join(" ") };
}

async function quiesce(page: Page, deadline: number, milliseconds: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  await page.waitForTimeout(Math.min(milliseconds, remaining));
}

function httpOrigin(url: URL): string {
  const normalized = new URL(url);
  if (normalized.protocol === "ws:") normalized.protocol = "http:";
  if (normalized.protocol === "wss:") normalized.protocol = "https:";
  return normalized.origin;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
