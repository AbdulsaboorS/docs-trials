import { launch, type BrowserWorker, type Locator, type Page } from "@cloudflare/playwright";
import type { BrowserGrade } from "./controlled-run-results";
import type { GraderResult } from "./domain";
import { redact } from "./redact";
import { evaluateUpdatesFilterObservations } from "./updates-filter-grader";

const evidenceId = "browser-session";
const maxBrowserMessages = 100;
const maxBrowserMessageChars = 2_000;
const maxScreenshotBytes = 2_000_000;

export async function gradeUpdatesFilterPage(
  browserBinding: BrowserWorker,
  previewUrl: string,
  maxBrowserSeconds: number,
): Promise<BrowserGrade> {
  const browser = await launch(browserBinding, {
    recording: false,
    keep_alive: maxBrowserSeconds * 1_000,
  });
  const consoleMessages: string[] = [];
  const networkFailures: string[] = [];
  const unexpectedExternalRequests: string[] = [];
  const previewOrigin = new URL(previewUrl).origin;
  const deadline = Date.now() + maxBrowserSeconds * 1_000;

  try {
    const page = await browser.newPage();
    setRemainingBrowserTimeout(page, deadline);
    page.on("pageerror", (error) => pushBrowserMessage(consoleMessages, error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pushBrowserMessage(consoleMessages, message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 500)
        pushBrowserMessage(networkFailures, `${response.status()} ${response.url()}`);
    });
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.protocol.startsWith("http") && requestUrl.origin !== previewOrigin) {
        pushBrowserMessage(unexpectedExternalRequests, requestUrl.toString());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    let navigationSucceeded = true;
    try {
      await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (unexpectedExternalRequests.length === 0) throw error;
      navigationSucceeded = false;
    }

    setRemainingBrowserTimeout(page, deadline);
    const heading = page.getByRole("heading", { name: "Updates", exact: true });
    const headingVisible = navigationSucceeded && (await isUniqueVisible(heading));
    const updates = page.getByRole("article");
    const initialUpdates = navigationSucceeded ? await visibleContents(updates) : [];

    const platformButton = page.getByRole("button", { name: "Platform", exact: true });
    if (navigationSucceeded && (await isUniqueVisible(platformButton))) {
      try {
        setRemainingBrowserTimeout(page, deadline);
        await platformButton.click();
      } catch {
        // A blocked application control is an observed task failure, not missing infrastructure.
      }
    }
    const platformUpdates = navigationSucceeded ? await visibleContents(updates) : [];

    const archivedButton = page.getByRole("button", { name: "Archived", exact: true });
    if (navigationSucceeded && (await isUniqueVisible(archivedButton))) {
      try {
        setRemainingBrowserTimeout(page, deadline);
        await archivedButton.click();
      } catch {
        // A blocked application control is an observed task failure, not missing infrastructure.
      }
    }
    const emptyMessage = page.getByText("No updates found.", { exact: true });
    const emptyMessageVisible = navigationSucceeded && (await isUniqueVisible(emptyMessage));
    let screenshot: Uint8Array | undefined;
    try {
      setRemainingBrowserTimeout(page, deadline);
      const captured = await page.screenshot({ fullPage: false });
      if (captured.byteLength <= maxScreenshotBytes) screenshot = captured;
    } catch {
      // A screenshot failure must not erase deterministic DOM observations.
    }

    return {
      sessionId: browser.sessionId(),
      consoleMessages,
      networkFailures,
      unexpectedExternalRequests,
      screenshotCaptured: Boolean(screenshot),
      ...(screenshot ? { screenshot } : {}),
      results: evaluateUpdatesFilterObservations({
        headingVisible,
        initialUpdateCount: initialUpdates.length,
        initialUpdateText: initialUpdates.join(" "),
        platformUpdateCount: platformUpdates.length,
        platformUpdateText: platformUpdates.join(" "),
        emptyMessageVisible,
        consoleMessages,
        networkFailures,
        unexpectedExternalRequests,
      }),
    };
  } finally {
    await browser.close();
  }
}

export async function gradeRealtimeKitRoom(
  browserBinding: BrowserWorker,
  previewUrl: string,
): Promise<BrowserGrade> {
  const browser = await launch(browserBinding, { recording: false, keep_alive: 120_000 });
  const consoleMessages: string[] = [];
  const networkFailures: string[] = [];
  let screenshot: Uint8Array | undefined;

  try {
    const participantA = await browser.newContext();
    const participantB = await browser.newContext();
    const pageA = await participantA.newPage();
    const pageB = await participantB.newPage();
    for (const page of [pageA, pageB]) {
      page.on("pageerror", (error) => consoleMessages.push(redact(error.message)));
      page.on("console", (message) => {
        if (message.type() === "error") consoleMessages.push(redact(message.text()));
      });
      page.on("response", (response) => {
        if (response.status() >= 500)
          networkFailures.push(redact(`${response.status()} ${response.url()}`));
      });
      await page.goto(previewUrl, { waitUntil: "networkidle" });
    }

    await pageA.getByTestId("join-room").click();
    await pageB.getByTestId("join-room").click();
    await pageA.getByTestId("publish-media").click();
    await pageB.getByTestId("publish-media").click();
    const countA = await pageA.getByTestId("participant-count").textContent();
    const countB = await pageB.getByTestId("participant-count").textContent();
    await pageB.getByTestId("leave-room").click();
    const countAfterLeave = await pageA.getByTestId("participant-count").textContent();
    await pageB.getByTestId("join-room").click();
    const countAfterRejoin = await pageA.getByTestId("participant-count").textContent();
    screenshot = await pageA.screenshot({ fullPage: true });

    const noErrors = consoleMessages.length === 0 && networkFailures.length === 0;
    const results: GraderResult[] = [
      result("Participant A can join the configured test room.", countA === "2"),
      result("Participant B can join the same room in a separate browser context.", countB === "2"),
      result(
        "Each participant's UI reflects that two participants are present.",
        countA === "2" && countB === "2",
      ),
      inconclusiveResult(
        "Each participant can publish camera and microphone media using supplied test capabilities or controlled substitutes.",
        "The current grader does not observe published media tracks authoritatively.",
      ),
      result(
        "Leaving removes a participant from the other participant's UI.",
        countAfterLeave === "1",
      ),
      result("Rejoining restores two-participant state.", countAfterRejoin === "2"),
      inconclusiveResult(
        "No persistent token or room credential is present in browser-delivered JavaScript, source maps, DOM content, screenshots, or saved logs.",
        "The current grader does not inspect every browser-delivered asset and saved evidence surface.",
      ),
      result(
        "The browser console and network checks contain no unhandled application error.",
        noErrors,
      ),
    ];
    return {
      sessionId: browser.sessionId(),
      consoleMessages,
      networkFailures,
      screenshotCaptured: Boolean(screenshot),
      ...(screenshot ? { screenshot } : {}),
      results,
    };
  } finally {
    await browser.close();
  }
}

async function visibleContents(locator: Locator): Promise<string[]> {
  const contents: string[] = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) contents.push((await item.textContent()) ?? "");
  }
  return contents;
}

async function isUniqueVisible(locator: Locator): Promise<boolean> {
  return (await locator.count()) === 1 && locator.first().isVisible();
}

function setRemainingBrowserTimeout(page: Page, deadline: number): void {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Browser verification exceeded its time limit.");
  page.setDefaultTimeout(remaining);
  page.setDefaultNavigationTimeout(remaining);
}

function pushBrowserMessage(target: string[], value: string): void {
  if (target.length >= maxBrowserMessages) return;
  target.push(redact(value).slice(0, maxBrowserMessageChars));
}

function inconclusiveResult(criterion: string, detail: string): GraderResult {
  return { criterion, outcome: "inconclusive", detail, evidenceIds: [evidenceId] };
}

function result(criterion: string, passed: boolean): GraderResult {
  return {
    criterion,
    outcome: passed ? "passed" : "failed",
    detail: passed
      ? "Browser grader observed the expected state."
      : "Browser grader did not observe the expected state.",
    evidenceIds: [evidenceId],
  };
}
