import { createHash } from "node:crypto";
import { z } from "zod";
import { redact } from "../core/redact";
import { findSecrets, type SecretFinding } from "./secrets";

const maxResponseBytes = 1_048_576;
const maxAggregateBytes = 2_097_152;
const maxCdpResourceBufferBytes = 2_097_152;
const maxCdpTotalBufferBytes = 4_194_304;
const maxResponseStates = 128;
const maxOperations = maxResponseStates * 2;
const maxRequestIdChars = 200;
const maxUrlChars = 500;
const maxContentTypeChars = 200;
const maxGapExamples = 3;
const maxGapChars = 500;
const defaultOperationTimeoutMs = 5_000;

type ContentDisposition = "complete" | "truncated" | "skipped" | "unavailable" | "pending";

type ContentResponse = {
  url: string;
  status: number;
  contentType: string;
  observedBytes: number;
  disposition: ContentDisposition;
  digest?: string;
};

export type ContentScan = {
  responsesScanned: number;
  bytesScanned: number;
  findings: SecretFinding[];
  gaps: string[];
  knownGapCount: number;
  captureFaultCount: number;
  responses: ContentResponse[];
};

type ResponseState = {
  response: ContentResponse;
  recorded: boolean;
  chunks: Buffer[];
  retainedBytes: number;
  streaming: boolean;
  initialized: boolean;
  finished: boolean;
  unavailable: boolean;
  truncated: boolean;
  skipped: boolean;
};

const headerValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const cdpResponseSchema = z.object({
  url: z.string(),
  status: z.number(),
  mimeType: z.string(),
  headers: z.record(z.string(), headerValueSchema),
});
type CdpResponse = z.infer<typeof cdpResponseSchema>;
const requestEventSchema = z.object({
  requestId: z.string(),
  request: z.object({ url: z.string() }),
  redirectResponse: cdpResponseSchema.optional(),
});
const responseEventSchema = z.object({ requestId: z.string(), response: cdpResponseSchema });
const pausedEventSchema = z.object({
  requestId: z.string(),
  networkId: z.string().optional(),
  request: z.object({ url: z.string() }),
  responseStatusCode: z.number().optional(),
  responseHeaders: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});
const pausedRequestIdSchema = z.object({ requestId: z.string() });
const dataEventSchema = z.object({
  requestId: z.string(),
  dataLength: z.number().int().nonnegative(),
  data: z.string().optional(),
});
const lifecycleEventSchema = z.object({ requestId: z.string() });
const streamResultSchema = z.object({ bufferedData: z.string() });

type ContentCapture = { finish: () => Promise<ContentScan> };
type ContentCaptureOptions = { operationTimeoutMs?: number };
type CdpMethod =
  | "Network.enable"
  | "Fetch.enable"
  | "Network.streamResourceContent"
  | "Fetch.continueRequest"
  | "Fetch.disable"
  | "Network.disable";
type CdpValue = string | number | boolean | null | readonly CdpValue[] | CdpPayload;
type CdpPayload = { readonly [key: string]: CdpValue };
type ContentSession = {
  on: (event: string, listener: (event: CdpPayload) => void) => object;
  send: (method: CdpMethod, params?: CdpPayload) => Promise<CdpPayload>;
  detach: () => Promise<void>;
};

export async function startContentCapture(
  session: ContentSession,
  origin: string,
  options: ContentCaptureOptions = {},
): Promise<ContentCapture> {
  const activeStates = new Map<string, ResponseState>();
  const retainedStates: ResponseState[] = [];
  const responses: ContentResponse[] = [];
  const operations = new Set<Promise<void>>();
  const gapExamples: string[] = [];
  let retainedTotal = 0;
  let captureFaultCount = 0;
  let collecting = true;
  const operationTimeoutMs = options.operationTimeoutMs ?? defaultOperationTimeoutMs;

  session.on("Network.requestWillBeSent", (event) => {
    if (!collecting) return;
    const parsed = requestEventSchema.safeParse(event);
    if (!parsed.success) {
      recordFault("Malformed Network.requestWillBeSent event.");
      return;
    }
    const entry = parsed.data;
    if (!requestIdAllowed(entry.requestId)) return;
    const redirectedState = activeStates.get(entry.requestId);
    if (entry.redirectResponse && redirectedState) {
      recordResponse(redirectedState, entry.redirectResponse);
      redirectedState.finished = true;
      if (!redirectedState.streaming) {
        redirectedState.initialized = true;
        redirectedState.unavailable = true;
      }
    }
    if (!sameOrigin(entry.request.url, origin)) {
      activeStates.delete(entry.requestId);
      return;
    }
    activeStates.delete(entry.requestId);
    const state = createState(entry.request.url);
    if (state) activeStates.set(entry.requestId, state);
  });

  session.on("Network.responseReceived", (event) => {
    if (!collecting) return;
    const parsed = responseEventSchema.safeParse(event);
    if (!parsed.success) {
      recordFault("Malformed Network.responseReceived event.");
      return;
    }
    const entry = parsed.data;
    if (!requestIdAllowed(entry.requestId)) return;
    if (!sameOrigin(entry.response.url, origin)) return;
    const state = activeStates.get(entry.requestId) ?? createState(entry.response.url);
    if (!state) return;
    activeStates.set(entry.requestId, state);
    recordResponse(state, entry.response);
  });

  session.on("Fetch.requestPaused", (event) => {
    const parsed = pausedEventSchema.safeParse(event);
    if (!parsed.success) {
      recordFault("Malformed Fetch.requestPaused event.");
      const requestId = pausedRequestIdSchema.safeParse(event).data?.requestId;
      if (requestId && requestIdAllowed(requestId)) continueResponse(requestId);
      return;
    }
    const entry = parsed.data;
    if (!requestIdAllowed(entry.requestId)) return;
    if (
      !collecting ||
      entry.networkId === undefined ||
      entry.responseStatusCode === undefined ||
      !sameOrigin(entry.request.url, origin)
    ) {
      continueResponse(entry.requestId);
      return;
    }
    if (!requestIdAllowed(entry.networkId)) {
      continueResponse(entry.requestId);
      return;
    }
    const state = activeStates.get(entry.networkId) ?? createState(entry.request.url);
    if (state) {
      activeStates.set(entry.networkId, state);
      recordResponse(state, {
        url: entry.request.url,
        status: entry.responseStatusCode,
        mimeType: "",
        headers: Object.fromEntries(
          (entry.responseHeaders ?? []).map((header) => [header.name, header.value]),
        ),
      });
      startStreaming(entry.networkId, state);
    }
    continueResponse(entry.requestId, state);
  });

  session.on("Network.dataReceived", (event) => {
    if (!collecting) return;
    const parsed = dataEventSchema.safeParse(event);
    if (!parsed.success) {
      recordFault("Malformed Network.dataReceived event.");
      return;
    }
    const entry = parsed.data;
    if (!requestIdAllowed(entry.requestId)) return;
    const state = activeStates.get(entry.requestId);
    if (!state) return;
    // streamResourceContent returns all bytes from events queued before its command response.
    if (!state.initialized) return;
    if (entry.data === undefined) {
      state.response.observedBytes += entry.dataLength;
      if (entry.dataLength > 0) state.unavailable = true;
      return;
    }
    const decodedBytes = base64Bytes(entry.data);
    if (decodedBytes !== entry.dataLength) {
      state.response.observedBytes += entry.dataLength;
      state.unavailable = true;
      recordFault("Network.dataReceived byte counts did not match.");
      return;
    }
    retain(state, entry.data, decodedBytes);
  });

  session.on("Network.loadingFinished", (event) => finishRequest(event, false));
  session.on("Network.loadingFailed", (event) => finishRequest(event, true));

  await sendWithin(
    session,
    "Network.enable",
    {
      maxTotalBufferSize: maxCdpTotalBufferBytes,
      maxResourceBufferSize: maxCdpResourceBufferBytes,
    },
    operationTimeoutMs,
  );
  await sendWithin(
    session,
    "Fetch.enable",
    {
      patterns: [{ urlPattern: `${origin}*`, requestStage: "Response" }],
    },
    operationTimeoutMs,
  );

  return {
    finish: async () => {
      collecting = false;
      await settleOperations();
      await teardown("Fetch.disable");
      await teardown("Network.disable");
      await detach();

      const findings: SecretFinding[] = [];
      let responsesScanned = 0;
      let bytesScanned = 0;
      let knownGapCount = 0;
      for (const state of retainedStates) {
        finalize(state);
        if (!state.recorded) {
          if (!state.finished) {
            knownGapCount += 1;
            addGap(`pending same-origin response: ${state.response.url}`);
          }
          continue;
        }
        const body = Buffer.concat(state.chunks, state.retainedBytes);
        if (findings.length < 20 && body.length > 0) {
          findings.push(
            ...findSecrets([{ url: state.response.url, body: body.toString("utf8") }]).slice(
              0,
              20 - findings.length,
            ),
          );
        }
        if (state.response.disposition !== "complete") {
          knownGapCount += 1;
          addGap(`${state.response.disposition} same-origin response body: ${state.response.url}`);
          continue;
        }
        state.response.digest = createHash("sha256").update(body).digest("hex");
        responsesScanned += 1;
        bytesScanned += state.response.observedBytes;
      }

      return {
        responsesScanned,
        bytesScanned,
        findings,
        gaps: gapExamples,
        knownGapCount,
        captureFaultCount,
        responses,
      };
    },
  };

  function finishRequest(event: CdpPayload, failed: boolean): void {
    if (!collecting) return;
    const parsed = lifecycleEventSchema.safeParse(event);
    if (!parsed.success) {
      recordFault(`Malformed Network.loading${failed ? "Failed" : "Finished"} event.`);
      return;
    }
    if (!requestIdAllowed(parsed.data.requestId)) return;
    const state = activeStates.get(parsed.data.requestId);
    if (!state) return;
    state.finished = true;
    if (failed) state.unavailable = true;
    activeStates.delete(parsed.data.requestId);
  }

  function retain(state: ResponseState, encoded: string, observedBytes: number): void {
    state.response.observedBytes += observedBytes;
    if (state.unavailable || state.truncated || state.skipped || observedBytes === 0) return;
    const responseRemaining = maxResponseBytes - state.retainedBytes;
    const aggregateRemaining = maxAggregateBytes - retainedTotal;
    const retainedBytes = Math.min(observedBytes, responseRemaining, aggregateRemaining);
    if (retainedBytes > 0) {
      const chunk = decodePrefix(encoded, retainedBytes);
      state.chunks.push(chunk);
      state.retainedBytes += chunk.byteLength;
      retainedTotal += chunk.byteLength;
    }
    if (retainedBytes >= observedBytes) return;
    if (state.retainedBytes === 0 && aggregateRemaining === 0) state.skipped = true;
    else state.truncated = true;
  }

  function createState(url: string): ResponseState | undefined {
    if (retainedStates.length >= maxResponseStates) {
      recordFault("Same-origin response metadata limit reached.");
      return undefined;
    }
    const state: ResponseState = {
      response: {
        url: boundedUrl(url),
        status: 0,
        contentType: "",
        observedBytes: 0,
        disposition: "pending",
      },
      recorded: false,
      chunks: [],
      retainedBytes: 0,
      streaming: false,
      initialized: false,
      finished: false,
      unavailable: false,
      truncated: false,
      skipped: false,
    };
    retainedStates.push(state);
    return state;
  }

  function recordResponse(state: ResponseState, response: CdpResponse): void {
    state.response.url = boundedUrl(response.url);
    state.response.status = response.status;
    state.response.contentType = boundedContentType(contentType(response));
    if (state.recorded) return;
    state.recorded = true;
    responses.push(state.response);
  }

  function startStreaming(requestId: string, state: ResponseState): void {
    if (state.streaming) return;
    state.streaming = true;
    if (!reserveOperation(state)) return;
    trackOperation(
      session.send("Network.streamResourceContent", { requestId }).then((value) => {
        const result = streamResultSchema.parse(value);
        state.initialized = true;
        retain(state, result.bufferedData, base64Bytes(result.bufferedData));
      }),
      () => {
        state.initialized = true;
        state.unavailable = true;
      },
    );
  }

  function continueResponse(requestId: string, state?: ResponseState): void {
    if (!reserveOperation(state)) return;
    trackOperation(
      session.send("Fetch.continueRequest", { requestId }).then(() => undefined),
      () => {
        if (state) state.unavailable = true;
        else recordFault("Could not continue an intercepted response.");
      },
    );
  }

  function trackOperation(operation: Promise<void>, failed: () => void): void {
    const bounded = withTimeout(operation, operationTimeoutMs)
      .catch(() => failed())
      .finally(() => operations.delete(bounded));
    operations.add(bounded);
  }

  function reserveOperation(state?: ResponseState): boolean {
    if (operations.size < maxOperations) return true;
    recordFault("CDP operation tracking limit reached.");
    if (state) state.unavailable = true;
    return false;
  }

  async function settleOperations(): Promise<void> {
    await Promise.allSettled(operations);
  }

  async function teardown(method: "Fetch.disable" | "Network.disable"): Promise<void> {
    try {
      await sendWithin(session, method, undefined, operationTimeoutMs);
    } catch {
      recordFault(`Could not complete ${method}.`);
    }
  }

  async function detach(): Promise<void> {
    try {
      await withTimeout(session.detach(), operationTimeoutMs);
    } catch {
      recordFault("Could not detach the content capture session.");
    }
  }

  function recordFault(detail: string): void {
    captureFaultCount = Math.min(Number.MAX_SAFE_INTEGER, captureFaultCount + 1);
    addGap(`capture fault: ${detail}`);
  }

  function addGap(detail: string): void {
    if (gapExamples.length >= maxGapExamples) return;
    gapExamples.push(redact(detail).slice(0, maxGapChars));
  }

  function boundedUrl(value: string): string {
    if (value.length > maxUrlChars) recordFault("Response URL exceeded the metadata limit.");
    return redact(value.slice(0, maxUrlChars));
  }

  function boundedContentType(value: string): string {
    if (value.length > maxContentTypeChars) {
      recordFault("Response content type exceeded the metadata limit.");
    }
    return value.slice(0, maxContentTypeChars);
  }

  function requestIdAllowed(value: string): boolean {
    if (value.length <= maxRequestIdChars) return true;
    recordFault("CDP request identifier exceeded the metadata limit.");
    return false;
  }
}

async function sendWithin(
  session: Pick<ContentSession, "send">,
  method: "Network.enable" | "Fetch.enable" | "Fetch.disable" | "Network.disable",
  params?: CdpPayload,
  timeoutMs = defaultOperationTimeoutMs,
): Promise<CdpPayload> {
  return withTimeout(session.send(method, params), timeoutMs);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP operation timed out.")), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new Error("CDP operation failed."));
      },
    );
  });
}

function finalize(state: ResponseState): void {
  state.response.disposition =
    state.unavailable || !state.initialized
      ? "unavailable"
      : state.skipped
        ? "skipped"
        : state.truncated
          ? "truncated"
          : state.finished
            ? "complete"
            : "pending";
}

function decodePrefix(value: string, bytes: number): Buffer {
  const encodedChars = Math.ceil(bytes / 3) * 4;
  return Buffer.from(value.slice(0, encodedChars), "base64").subarray(0, bytes);
}

function base64Bytes(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function contentType(response: CdpResponse): string {
  const header = Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  return z.string().safeParse(header).data ?? response.mimeType;
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}
