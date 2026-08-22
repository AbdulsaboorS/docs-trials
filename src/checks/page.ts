import { chromium, type Browser, type Page, type Request, type Response } from "playwright";
import { redact } from "../core/redact";
import { findSecrets, type SecretFinding } from "./secrets";

const maxMessages = 60;
const maxMessageChars = 500;
const requiredResourceTypes = new Set([
  "script",
  "stylesheet",
  "image",
  "font",
  "media",
  "texttrack",
  "manifest",
]);

type ContentScan = {
  responsesScanned: number;
  bytesScanned: number;
  findings: SecretFinding[];
  gaps: string[];
};

type VisibleContentKind = "text" | "image" | "svg" | "canvas" | "video" | "iframe" | "form-control";

type VisibleContent = { kind: VisibleContentKind } | null;

export type PageObservation =
  | { available: false; detail: string }
  | {
      available: true;
      navigated: boolean;
      navigationDetail: string;
      httpStatus: number | undefined;
      consoleErrors: string[];
      droppedConsoleErrors: number;
      pageErrors: string[];
      resourceFailures: string[];
      pendingResources: string[];
      serverErrors: string[];
      externalOrigins: string[];
      ungradedObservations: string[];
      contentScan: ContentScan;
      visibleContent: VisibleContent | undefined;
      visibleContentDetail: string | undefined;
      title: string;
      bodyTextSample: string;
    };

/** Opens the preview and records the facts used by the deterministic checks. */
export async function observePage(
  url: string,
  timeoutSeconds: number,
  observationWindowSeconds: number,
): Promise<PageObservation> {
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
  let droppedConsoleErrors = 0;
  const pageErrors: string[] = [];
  const resourceFailures: string[] = [];
  const serverErrors: string[] = [];
  const ungradedObservations: string[] = [];
  const externalOrigins = new Set<string>();
  const pendingResources = new Map<Request, string>();
  const failedResources = new Set<Request>();
  const declaredManifestUrls = new Set<string>();
  const pendingContentRequests = new Set<Request>();
  const responses = new Map<Request, Response>();
  const scans = new Set<Promise<void>>();
  const contentScan: ContentScan = {
    responsesScanned: 0,
    bytesScanned: 0,
    findings: [],
    gaps: [],
  };
  const previewOrigin = new URL(url).origin;
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let collecting = true;

  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Runtime.enable");
    page.setDefaultTimeout(remaining(deadline));

    cdp.on("Runtime.consoleAPICalled", (entry) => {
      if (!collecting || entry.type !== "error") return;
      if (consoleErrors.length >= maxMessages) {
        droppedConsoleErrors += 1;
        return;
      }
      push(consoleErrors, entry.args.map(describeConsoleArgument).join(" "));
    });
    page.on("pageerror", (error) => {
      if (collecting) push(pageErrors, error.message);
    });
    page.on("websocket", (webSocket) => {
      if (!collecting) return;
      const origin = safeOrigin(webSocket.url());
      if (origin && origin !== previewOrigin) externalOrigins.add(origin);
    });
    page.on("request", (request) => {
      if (!collecting) return;
      const origin = safeOrigin(request.url());
      if (origin && origin !== previewOrigin) externalOrigins.add(origin);
      if (origin === previewOrigin) pendingContentRequests.add(request);
      if (isRequiredResource(request, page, previewOrigin, declaredManifestUrls)) {
        pendingResources.set(request, describeRequest(request));
      }
    });
    page.on("response", (response) => {
      if (!collecting) return;
      const request = response.request();
      const status = response.status();
      if (status >= 500) push(serverErrors, `${status} ${response.url()}`);
      if (status >= 400) {
        if (isRequiredResource(request, page, previewOrigin, declaredManifestUrls)) {
          recordResourceFailure(request, `${status} ${response.url()}`);
        } else if (isUngradedFailure(request, page, previewOrigin, declaredManifestUrls)) {
          push(ungradedObservations, `${status} ${response.url()}`);
        }
      }
      if (safeOrigin(response.url()) === previewOrigin) responses.set(request, response);
    });
    page.on("requestfinished", (request) => {
      if (!collecting) return;
      pendingResources.delete(request);
      pendingContentRequests.delete(request);
      const response = responses.get(request);
      if (!response) return;
      responses.delete(request);
      const scan = scanResponse(response, contentScan).finally(() => scans.delete(scan));
      scans.add(scan);
    });
    page.on("requestfailed", (request) => {
      if (!collecting) return;
      pendingResources.delete(request);
      pendingContentRequests.delete(request);
      const response = responses.get(request);
      responses.delete(request);
      if (response) {
        const scan = scanResponse(response, contentScan).finally(() => scans.delete(scan));
        scans.add(scan);
      }
      if (isRequiredResource(request, page, previewOrigin, declaredManifestUrls)) {
        const reason = request.failure()?.errorText ?? "request failed";
        recordResourceFailure(request, `${reason} ${request.url()}`);
      } else if (isUngradedFailure(request, page, previewOrigin, declaredManifestUrls)) {
        const reason = request.failure()?.errorText ?? "request failed";
        push(ungradedObservations, `${reason} ${request.url()}`);
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
      const manifests = await page
        .evaluate(() =>
          Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="manifest"]')).map(
            (link) => link.href,
          ),
        )
        .catch(() => []);
      const sameOriginManifests = manifests.filter(
        (manifest) => safeOrigin(manifest) === previewOrigin,
      );
      for (const manifest of sameOriginManifests) declaredManifestUrls.add(manifest);
      await page.evaluate((urls) => {
        for (const manifest of urls) void fetch(manifest).catch(() => undefined);
      }, sameOriginManifests);
      await page.waitForTimeout(Math.min(observationWindowSeconds * 1_000, remaining(deadline)));
    }
    collecting = false;
    const pendingResourceSnapshot = [...pendingResources.values()].sort();

    for (const request of pendingContentRequests) {
      push(contentScan.gaps, `The same-origin response did not complete: ${request.url()}`);
    }
    for (const response of responses.values()) {
      if (!pendingContentRequests.has(response.request())) {
        push(contentScan.gaps, `The response body did not complete: ${response.url()}`);
      }
    }
    responses.clear();
    await Promise.allSettled(scans);
    const title = navigated ? await page.title().catch(() => "") : "";
    const surface = navigated ? await inspectSurface(page) : undefined;

    return {
      available: true,
      navigated,
      navigationDetail,
      httpStatus,
      consoleErrors,
      droppedConsoleErrors,
      pageErrors,
      resourceFailures,
      pendingResources: pendingResourceSnapshot,
      serverErrors,
      externalOrigins: [...externalOrigins].sort(),
      ungradedObservations,
      contentScan,
      visibleContent: surface?.visibleContent,
      visibleContentDetail: surface?.detail,
      title,
      bodyTextSample: redact(surface?.bodyTextSample ?? ""),
    };

    function recordResourceFailure(request: Request, detail: string): void {
      if (failedResources.has(request)) return;
      failedResources.add(request);
      pendingResources.delete(request);
      push(resourceFailures, detail);
    }
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

async function scanResponse(response: Response, scan: ContentScan): Promise<void> {
  try {
    const body = await response.body();
    scan.responsesScanned += 1;
    scan.bytesScanned += body.byteLength;
    if (scan.findings.length < 20) {
      const findings = findSecrets([
        { url: redact(response.url()), body: body.toString("utf8") },
      ]).slice(0, 20 - scan.findings.length);
      scan.findings.push(...findings);
    }
  } catch {
    if (scan.gaps.length < maxMessages) {
      scan.gaps.push(redact(`Could not read the complete response body: ${response.url()}`));
    }
  }
}

function isRequiredResource(
  request: Request,
  page: Page,
  previewOrigin: string,
  declaredManifestUrls: ReadonlySet<string>,
): boolean {
  for (let current: Request | null = request; current; current = current.redirectedFrom()) {
    if (safeOrigin(current.url()) !== previewOrigin) continue;
    if (declaredManifestUrls.has(current.url())) return true;
    const type = current.resourceType();
    if (requiredResourceTypes.has(type)) return true;
    if (type !== "document") continue;
    try {
      if (current.frame() !== page.mainFrame()) return true;
    } catch {
      // A detached frame cannot establish that the document was required.
    }
  }
  return false;
}

function isUngradedFailure(
  request: Request,
  page: Page,
  previewOrigin: string,
  declaredManifestUrls: ReadonlySet<string>,
): boolean {
  if (isMainNavigation(request, page)) return false;
  const origin = safeOrigin(request.url());
  return (
    origin !== undefined &&
    (origin !== previewOrigin ||
      !isRequiredResource(request, page, previewOrigin, declaredManifestUrls))
  );
}

function isMainNavigation(request: Request, page: Page): boolean {
  if (request.resourceType() !== "document") return false;
  try {
    return request.frame() === page.mainFrame();
  } catch {
    return false;
  }
}

function describeRequest(request: Request): string {
  return `${request.resourceType()} ${redact(request.url())}`;
}

async function inspectSurface(page: Page): Promise<{
  visibleContent: VisibleContent | undefined;
  bodyTextSample: string;
  detail: string | undefined;
}> {
  return page
    .evaluate<{
      kind: VisibleContentKind | undefined;
      bodyTextSample: string;
      uncertain: boolean;
    }>(async () => {
      const bodyTextSample = () => document.body?.innerText.slice(0, 2_000) ?? "";
      let uncertain = false;
      const hasVisibleStyle = (element: Element) => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            Number(style.opacity) === 0 ||
            /opacity\((?:0|0%)\)/.test(style.filter)
          ) {
            return false;
          }
          if (style.clipPath !== "none") {
            if (/^inset\(\s*(?:100%|[1-9]\d{2,}%)/.test(style.clipPath)) return false;
            uncertain = true;
            return false;
          }
          if (style.maskImage !== "none") {
            uncertain = true;
            return false;
          }
        }
        return true;
      };
      const intersectsVisibleRegion = (rectangle: DOMRect, element: Element) => {
        let left = Math.max(0, rectangle.left);
        let top = Math.max(0, rectangle.top);
        let right = Math.min(window.innerWidth, rectangle.right);
        let bottom = Math.min(window.innerHeight, rectangle.bottom);
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          const currentRectangle = current.getBoundingClientRect();
          if (["auto", "clip", "hidden", "scroll"].includes(style.overflowX)) {
            left = Math.max(left, currentRectangle.left + current.clientLeft);
            right = Math.min(
              right,
              currentRectangle.left + current.clientLeft + current.clientWidth,
            );
          }
          if (["auto", "clip", "hidden", "scroll"].includes(style.overflowY)) {
            top = Math.max(top, currentRectangle.top + current.clientTop);
            bottom = Math.min(
              bottom,
              currentRectangle.top + current.clientTop + current.clientHeight,
            );
          }
        }
        return right > left && bottom > top;
      };
      const pixelsHaveAlpha = (pixels: Uint8ClampedArray) =>
        pixels.some((value, index) => index % 4 === 3 && value > 0);
      const rasterHasPaint = (
        source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
        sourceWidth: number,
        sourceHeight: number,
      ): boolean | undefined => {
        const width = Math.max(1, Math.min(512, sourceWidth));
        const height = Math.max(1, Math.min(512, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return undefined;
        try {
          context.drawImage(source, 0, 0, width, height);
          return pixelsHaveAlpha(context.getImageData(0, 0, width, height).data);
        } catch {
          return undefined;
        }
      };
      const svgHasPaint = async (element: SVGSVGElement): Promise<boolean | undefined> => {
        const rectangle = element.getBoundingClientRect();
        const width = Math.max(1, Math.min(512, Math.round(rectangle.width)));
        const height = Math.max(1, Math.min(512, Math.round(rectangle.height)));
        const clone = element.cloneNode(true);
        if (!(clone instanceof SVGSVGElement)) return undefined;
        const sources = [element, ...Array.from(element.querySelectorAll("*"))];
        const targets = [clone, ...Array.from(clone.querySelectorAll("*"))];
        for (const [index, source] of sources.entries()) {
          const target = targets[index];
          if (!(target instanceof SVGElement)) continue;
          const computed = getComputedStyle(source);
          for (let propertyIndex = 0; propertyIndex < computed.length; propertyIndex += 1) {
            const property = computed.item(propertyIndex);
            target.style.setProperty(
              property,
              computed.getPropertyValue(property),
              computed.getPropertyPriority(property),
            );
          }
        }
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
        try {
          await image.decode();
          return rasterHasPaint(image, width, height);
        } catch {
          return undefined;
        }
      };

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (!node.textContent?.trim() || !element) continue;
        const color = getComputedStyle(element).color;
        if (
          !hasVisibleStyle(element) ||
          color === "transparent" ||
          /rgba\([^)]*,\s*0\)/.test(color)
        ) {
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        const rectangle = range.getBoundingClientRect();
        if (
          rectangle.width > 0 &&
          rectangle.height > 0 &&
          intersectsVisibleRegion(rectangle, element)
        ) {
          return { kind: "text", bodyTextSample: bodyTextSample(), uncertain: false };
        }
      }

      for (const element of Array.from(
        document.querySelectorAll(
          "img,svg,canvas,video,iframe,input,button,select,textarea,meter,progress",
        ),
      )) {
        const rectangle = element.getBoundingClientRect();
        if (
          !hasVisibleStyle(element) ||
          rectangle.width <= 0 ||
          rectangle.height <= 0 ||
          !intersectsVisibleRegion(rectangle, element)
        ) {
          continue;
        }
        if (element instanceof HTMLInputElement && element.type === "hidden") continue;
        let kind: VisibleContentKind;
        if (element instanceof HTMLImageElement) {
          if (!element.complete || element.naturalWidth === 0) continue;
          const painted = rasterHasPaint(element, element.naturalWidth, element.naturalHeight);
          if (painted === undefined) {
            uncertain = true;
            continue;
          }
          if (!painted) continue;
          kind = "image";
        } else if (element instanceof SVGSVGElement) {
          const painted = await svgHasPaint(element);
          if (painted === undefined) {
            uncertain = true;
            continue;
          }
          if (!painted) continue;
          kind = "svg";
        } else if (element instanceof HTMLCanvasElement) {
          const painted = rasterHasPaint(element, element.width, element.height);
          if (painted === undefined) {
            uncertain = true;
            continue;
          }
          if (!painted) continue;
          kind = "canvas";
        } else if (element instanceof HTMLVideoElement) {
          if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || element.videoWidth === 0) {
            if (element.currentSrc) uncertain = true;
            continue;
          }
          const painted = rasterHasPaint(element, element.videoWidth, element.videoHeight);
          if (painted === undefined) {
            uncertain = true;
            continue;
          }
          if (!painted) continue;
          kind = "video";
        } else if (element instanceof HTMLIFrameElement) {
          try {
            const frameDocument = element.contentDocument;
            if (!frameDocument) {
              uncertain = true;
              continue;
            }
            const frameBody = frameDocument.body;
            if (
              !frameBody?.innerText.trim() &&
              !frameBody?.querySelector("img,svg,canvas,video,form")
            ) {
              continue;
            }
          } catch {
            uncertain = true;
            continue;
          }
          kind = "iframe";
        } else {
          const style = getComputedStyle(element);
          const paints = [
            style.color,
            style.backgroundColor,
            style.borderTopColor,
            style.borderRightColor,
            style.borderBottomColor,
            style.borderLeftColor,
            style.outlineColor,
          ];
          if (
            style.backgroundImage === "none" &&
            paints.every((color) => color === "transparent" || /rgba\([^)]*,\s*0\)/.test(color))
          ) {
            continue;
          }
          kind = "form-control";
        }
        return { kind, bodyTextSample: bodyTextSample(), uncertain: false };
      }
      return { kind: undefined, bodyTextSample: bodyTextSample(), uncertain };
    })
    .then(({ kind, bodyTextSample, uncertain }) => ({
      visibleContent: kind ? { kind } : uncertain ? undefined : null,
      bodyTextSample,
      detail: uncertain
        ? "A visual surface existed, but its visible content could not be read."
        : undefined,
    }))
    .catch((error) => ({
      visibleContent: undefined,
      bodyTextSample: "",
      detail: `Could not inspect rendered content: ${message(error)}`,
    }));
}

function describeConsoleArgument(argument: {
  type: string;
  value?: unknown;
  description?: string;
}): string {
  if (argument.value !== undefined) {
    try {
      return JSON.stringify(argument.value) ?? String(argument.value);
    } catch {
      return String(argument.value);
    }
  }
  return argument.description ?? argument.type;
}

function remaining(deadline: number): number {
  return Math.max(1_000, deadline - Date.now());
}

function safeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function message(cause: unknown): string {
  return redact(cause instanceof Error ? cause.message : String(cause));
}
