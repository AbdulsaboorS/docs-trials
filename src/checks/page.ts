import { chromium, type Browser } from "playwright";
import { redact } from "../core/redact";

const maxMessages = 60;
const maxMessageChars = 500;
const maxAssetBytes = 4_000_000;

export type PageObservation =
  | { available: false; detail: string }
  | {
      available: true;
      navigated: boolean;
      navigationDetail: string;
      httpStatus: number | undefined;
      consoleErrors: string[];
      pageErrors: string[];
      resourceErrors: string[];
      serverErrors: string[];
      externalOrigins: string[];
      assets: Array<{ url: string; body: string }>;
      title: string;
      bodyTextSample: string;
    };

/**
 * Opens the preview and records what the browser saw.
 *
 * This observes. It does not assert anything about the task. A browser that
 * cannot start, or a navigation that times out, is reported as unavailable so
 * the caller can mark the affected checks inconclusive. Infrastructure trouble
 * must never be reported as an application defect.
 */
export async function observePage(url: string, timeoutSeconds: number): Promise<PageObservation> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return {
      available: false,
      detail: `Could not start Chromium: ${message(error)}. Install it with \`npx playwright install chromium\`.`,
    };
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const resourceErrors: string[] = [];
  const serverErrors: string[] = [];
  const externalOrigins = new Set<string>();
  const assets: Array<{ url: string; body: string }> = [];
  let assetBytes = 0;
  const previewOrigin = new URL(url).origin;
  const deadline = Date.now() + timeoutSeconds * 1_000;

  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(remaining(deadline));

    page.on("console", (entry) => {
      if (entry.type() !== "error") return;
      const text = entry.text();
      push(isResourceComplaint(text) ? resourceErrors : consoleErrors, text);
    });
    page.on("pageerror", (error) => push(pageErrors, error.message));
    page.on("requestfailed", (request) => {
      const origin = safeOrigin(request.url());
      if (origin && origin !== previewOrigin) externalOrigins.add(origin);
    });
    page.on("request", (request) => {
      const origin = safeOrigin(request.url());
      if (origin && origin !== previewOrigin) externalOrigins.add(origin);
    });
    page.on("response", async (response) => {
      if (response.status() >= 500) {
        push(serverErrors, `${response.status()} ${response.url()}`);
      }
      const type = response.request().resourceType();
      if (
        safeOrigin(response.url()) === previewOrigin &&
        (type === "script" || type === "document") &&
        assetBytes < maxAssetBytes
      ) {
        try {
          const body = await response.text();
          const bounded = body.slice(0, maxAssetBytes - assetBytes);
          assetBytes += bounded.length;
          assets.push({ url: response.url(), body: bounded });
        } catch {
          // A body may be unavailable after a redirect or an aborted request.
        }
      }
    });

    let navigated = true;
    let navigationDetail = "The entry page loaded.";
    let httpStatus: number | undefined;
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: remaining(deadline),
      });
      httpStatus = response?.status();
      if (httpStatus !== undefined && httpStatus >= 400) {
        navigationDetail = `The entry page returned HTTP ${httpStatus}.`;
      }
    } catch (error) {
      navigated = false;
      navigationDetail = `Navigation to ${url} did not complete: ${message(error)}`;
    }

    if (navigated) {
      await page.waitForTimeout(Math.min(750, remaining(deadline)));
      try {
        await page.waitForLoadState("networkidle", {
          timeout: Math.min(3_000, remaining(deadline)),
        });
      } catch {
        // A long-lived connection keeps the network busy. Continue.
      }
    }

    const title = navigated ? await page.title().catch(() => "") : "";
    const bodyTextSample = navigated
      ? await page.evaluate(() => (document.body?.innerText ?? "").slice(0, 2_000)).catch(() => "")
      : "";

    return {
      available: true,
      navigated,
      navigationDetail,
      httpStatus,
      consoleErrors,
      pageErrors,
      resourceErrors,
      serverErrors,
      externalOrigins: [...externalOrigins].sort(),
      assets,
      title,
      bodyTextSample: redact(bodyTextSample),
    };
  } catch (error) {
    return { available: false, detail: `Browser observation failed: ${message(error)}` };
  } finally {
    await browser.close().catch(() => undefined);
  }

  function push(target: string[], value: string): void {
    if (target.length >= maxMessages) return;
    target.push(redact(value).slice(0, maxMessageChars));
  }
}

/**
 * Chromium writes its own console errors when a subresource fails to load or a
 * cross-origin request is refused. Those describe the network, not the
 * application, and the egress check already reports them. Counting them as
 * application errors would turn an offline machine into a documentation
 * failure.
 */
function isResourceComplaint(text: string): boolean {
  return [
    "Failed to load resource",
    "net::ERR_",
    "has been blocked by CORS policy",
    "Access to fetch at",
    "Access to XMLHttpRequest at",
    "Access to script at",
    "ERR_BLOCKED_BY_CLIENT",
  ].some((marker) => text.includes(marker));
}

function remaining(deadline: number): number {
  return Math.max(1_000, deadline - Date.now());
}

function safeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("http") ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function message(cause: unknown): string {
  return redact(cause instanceof Error ? cause.message : String(cause));
}
