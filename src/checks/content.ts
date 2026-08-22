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
const defaultOperationTimeoutMs = 15_000;
const pausedStreamSetupTimeoutMs = 250;

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
  textDecodingGapCount: number;
  responses: ContentResponse[];
};

type ResponseState = {
  response: ContentResponse;
  recorded: boolean;
  chunks: Buffer[];
  retainedBytes: number;
  streaming: boolean;
  readyToStream: boolean;
  initialized: boolean;
  finished: boolean;
  unavailable: boolean;
  truncated: boolean;
  skipped: boolean;
  streamFailed: boolean;
  streamFailureDetail: string;
  observedBeforeInitialization: number;
  uncapturedBeforeInitialization: number;
  retainedBeforeInitialization: number;
  networkDataBytes: number;
  bufferedBytes: number;
  bufferedRetainedBytes: number;
  streamAttempts: number;
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
  | "Network.streamResourceContent"
  | "Fetch.enable"
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
    if (state.readyToStream && !state.streaming && !state.initialized) {
      startStreaming(entry.requestId, state);
    }
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
    if (!requestIdAllowed(entry.requestId)) {
      continueResponse(entry.requestId);
      return;
    }
    if (
      !collecting ||
      entry.networkId === undefined ||
      entry.responseStatusCode === undefined ||
      !sameOrigin(entry.request.url, origin) ||
      !requestIdAllowed(entry.networkId)
    ) {
      continueResponse(entry.requestId);
      return;
    }
    const networkId = entry.networkId;
    const state = activeStates.get(networkId) ?? createState(entry.request.url);
    if (state) {
      activeStates.set(networkId, state);
      startStreaming(
        networkId,
        state,
        Math.min(operationTimeoutMs, pausedStreamSetupTimeoutMs),
        () => {
          continueResponse(entry.requestId, state, () => {
            state.readyToStream = true;
            if (state.streamFailed) startStreaming(networkId, state);
          });
        },
      );
    } else {
      continueResponse(entry.requestId);
    }
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
    state.networkDataBytes += entry.dataLength;
    if (!state.initialized) {
      state.observedBeforeInitialization += entry.dataLength;
    }
    if (entry.data === undefined) {
      if (state.initialized) {
        state.response.observedBytes += entry.dataLength;
        if (entry.dataLength > 0) state.unavailable = true;
      } else {
        state.uncapturedBeforeInitialization += entry.dataLength;
      }
      return;
    }
    const decoded = decodeBase64(entry.data);
    if (!decoded || decoded.byteLength !== entry.dataLength) {
      state.response.observedBytes += entry.dataLength;
      state.unavailable = true;
      recordFault("Network.dataReceived contained invalid or mismatched base64 data.");
      return;
    }
    retain(state, decoded, entry.dataLength);
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
    { patterns: [{ urlPattern: `${origin}*`, requestStage: "Response" }] },
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
      let textDecodingGapCount = 0;
      for (const state of retainedStates) {
        normalizeCapturedBody(state);
        finalize(state);
        if (!state.recorded) {
          knownGapCount += 1;
          addGap(
            `${state.finished ? "unrecorded" : "pending"} same-origin response: ${state.response.url}`,
          );
          continue;
        }
        const body = Buffer.concat(state.chunks, state.retainedBytes);
        if (state.response.disposition !== "complete") {
          scanFindings(
            state.response.url,
            body,
            decodeForPartialScan(body, state.response.contentType),
          );
          knownGapCount += 1;
          addGap(`${state.response.disposition} same-origin response body: ${state.response.url}`);
          continue;
        }
        state.response.digest = createHash("sha256").update(body).digest("hex");
        const decoded = decodeCompleteBody(body, state.response.contentType);
        scanFindings(state.response.url, body, decoded.text);
        if (decoded.status === "gap") {
          textDecodingGapCount += 1;
          addGap(`${decoded.gap} textual response encoding: ${state.response.url}`);
          continue;
        }
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
        textDecodingGapCount,
        responses,
      };

      function scanFindings(url: string, body: Buffer, text: string): void {
        if (findings.length >= 20 || body.length === 0) return;
        findings.push(...findSecrets([{ url, body: text }]).slice(0, 20 - findings.length));
      }
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
    else if (state.streamFailed && !state.initialized) failStreaming(state);
    activeStates.delete(parsed.data.requestId);
  }

  function retain(
    state: ResponseState,
    chunk: Buffer,
    observedBytes: number,
    prepend = false,
  ): void {
    state.response.observedBytes += observedBytes;
    if (state.unavailable || state.truncated || state.skipped || observedBytes === 0) return;
    const responseRemaining = maxResponseBytes - state.retainedBytes;
    const aggregateRemaining = maxAggregateBytes - retainedTotal;
    const retainedBytes = Math.min(observedBytes, responseRemaining, aggregateRemaining);
    if (retainedBytes > 0) {
      const retained = chunk.subarray(0, retainedBytes);
      if (prepend) state.chunks.unshift(retained);
      else state.chunks.push(retained);
      state.retainedBytes += retained.byteLength;
      retainedTotal += retained.byteLength;
      if (!state.initialized) state.retainedBeforeInitialization += retained.byteLength;
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
      readyToStream: false,
      initialized: false,
      finished: false,
      unavailable: false,
      truncated: false,
      skipped: false,
      streamFailed: false,
      streamFailureDetail: "",
      observedBeforeInitialization: 0,
      uncapturedBeforeInitialization: 0,
      retainedBeforeInitialization: 0,
      networkDataBytes: 0,
      bufferedBytes: 0,
      bufferedRetainedBytes: 0,
      streamAttempts: 0,
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

  function startStreaming(
    requestId: string,
    state: ResponseState,
    timeoutMs = operationTimeoutMs,
    settled?: () => void,
  ): void {
    if (state.streaming || state.initialized || state.streamAttempts >= 2) return;
    state.streaming = true;
    state.streamFailed = false;
    state.streamAttempts += 1;
    if (!reserveOperation(state)) return;
    trackOperation(
      session.send("Network.streamResourceContent", { requestId }).then((value) => {
        const result = streamResultSchema.parse(value);
        const buffered = decodeBase64(result.bufferedData);
        if (!buffered) throw new Error("Buffered response data was not valid base64.");
        if (bufferCoversPendingData(buffered, state)) {
          state.chunks = [];
          state.retainedBytes -= state.retainedBeforeInitialization;
          retainedTotal -= state.retainedBeforeInitialization;
          state.response.observedBytes = 0;
          state.retainedBeforeInitialization = 0;
        }
        state.initialized = true;
        state.streamFailed = false;
        state.streamFailureDetail = "";
        const bufferedBytes = buffered.byteLength;
        state.bufferedBytes = bufferedBytes;
        const retainedBeforeBuffer = state.retainedBytes;
        retain(state, buffered, bufferedBytes, true);
        state.bufferedRetainedBytes = state.retainedBytes - retainedBeforeBuffer;
        state.response.observedBytes = Math.max(
          state.response.observedBytes,
          state.observedBeforeInitialization,
        );
        if (bufferedBytes < state.uncapturedBeforeInitialization) {
          state.unavailable = true;
          recordFault("Buffered response bytes did not cover pre-stream network data.");
        }
      }),
      (error) => {
        state.streaming = false;
        state.streamFailed = true;
        state.streamFailureDetail = errorDetail(error);
        if (state.readyToStream && !state.finished && state.streamAttempts < 2) {
          startStreaming(requestId, state);
        } else if (state.finished || state.streamAttempts >= 2) {
          failStreaming(state);
        }
      },
      timeoutMs,
      settled,
    );
  }

  function continueResponse(
    requestId: string,
    state?: ResponseState,
    continued?: () => void,
  ): void {
    if (!reserveOperation(state)) return;
    trackOperation(
      session.send("Fetch.continueRequest", { requestId }).then(() => continued?.()),
      () => {
        if (state) state.unavailable = true;
        recordFault("Could not continue an intercepted response.");
      },
    );
  }

  function bufferCoversPendingData(buffered: Buffer, state: ResponseState): boolean {
    const pendingBytes = state.retainedBeforeInitialization;
    if (
      pendingBytes === 0 ||
      buffered.byteLength < state.observedBeforeInitialization ||
      buffered.byteLength < pendingBytes
    ) {
      return false;
    }
    const pending = Buffer.concat(state.chunks, pendingBytes);
    return buffered.subarray(buffered.byteLength - pendingBytes).equals(pending);
  }

  function normalizeCapturedBody(state: ResponseState): void {
    if (
      state.unavailable ||
      state.truncated ||
      state.skipped ||
      !state.initialized ||
      state.retainedBytes === 0
    ) {
      return;
    }
    const observedBytes = Math.max(state.networkDataBytes, state.bufferedBytes);
    if (state.retainedBytes === observedBytes) {
      state.response.observedBytes = observedBytes;
      return;
    }
    if (state.retainedBytes < observedBytes) {
      state.unavailable = true;
      recordFault("Retained response bytes did not cover observed network data.");
      return;
    }
    const overlapBytes = state.retainedBytes - observedBytes;
    const bufferedEnd = state.bufferedRetainedBytes;
    const body = Buffer.concat(state.chunks, state.retainedBytes);
    const overlapIsExact =
      overlapBytes <= bufferedEnd &&
      bufferedEnd + overlapBytes <= body.byteLength &&
      body
        .subarray(bufferedEnd - overlapBytes, bufferedEnd)
        .equals(body.subarray(bufferedEnd, bufferedEnd + overlapBytes));
    if (!overlapIsExact) {
      state.unavailable = true;
      recordFault("Buffered and streamed response bytes had an unordered overlap.");
      return;
    }
    const normalized = Buffer.concat([
      body.subarray(0, bufferedEnd),
      body.subarray(bufferedEnd + overlapBytes),
    ]);
    state.chunks = [normalized];
    state.retainedBytes = normalized.byteLength;
    retainedTotal -= overlapBytes;
    state.response.observedBytes = observedBytes;
  }

  function failStreaming(state: ResponseState): void {
    if (state.initialized) return;
    state.initialized = true;
    state.unavailable = true;
    recordFault(
      `Could not start bounded response streaming${state.streamFailureDetail ? `: ${state.streamFailureDetail}` : "."}`,
    );
  }

  function trackOperation(
    operation: Promise<void>,
    failed: (error: Error) => void,
    timeoutMs = operationTimeoutMs,
    settled?: () => void,
  ): void {
    const bounded = withTimeout(operation, timeoutMs)
      .catch((error: Error) => failed(error))
      .finally(() => {
        operations.delete(bounded);
        settled?.();
      });
    operations.add(bounded);
  }

  function reserveOperation(state?: ResponseState): boolean {
    if (operations.size < maxOperations) return true;
    recordFault("CDP operation tracking limit reached.");
    if (state) state.unavailable = true;
    return false;
  }

  async function settleOperations(): Promise<void> {
    while (operations.size > 0) await Promise.allSettled(operations);
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
      (error) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error ? error : new Error(`CDP operation failed: ${String(error)}`),
        );
      },
    );
  });
}

function finalize(state: ResponseState): void {
  state.response.observedBytes = Math.max(
    state.response.observedBytes,
    state.observedBeforeInitialization,
  );
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

function decodeBase64(value: string): Buffer | undefined {
  if (value === "") return Buffer.alloc(0);
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : undefined;
}

function contentType(response: CdpResponse): string {
  const header = Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  return z.string().safeParse(header).data ?? response.mimeType;
}

type DecodedBody =
  | { status: "decoded"; text: string }
  | { status: "gap"; text: string; gap: "invalid" | "unsupported" };

function decodeCompleteBody(body: Buffer, contentType: string): DecodedBody {
  if (!isTextualContentType(contentType)) {
    return { status: "decoded", text: body.toString("latin1") };
  }
  const charset = declaredCharset(contentType);
  try {
    return { status: "decoded", text: new TextDecoder(charset, { fatal: true }).decode(body) };
  } catch (error) {
    return {
      status: "gap",
      text: body.toString("latin1"),
      gap: error instanceof RangeError ? "unsupported" : "invalid",
    };
  }
}

function decodeForPartialScan(body: Buffer, contentType: string): string {
  if (!isTextualContentType(contentType)) return body.toString("latin1");
  try {
    return new TextDecoder(declaredCharset(contentType)).decode(body);
  } catch {
    return body.toString("latin1");
  }
}

function isTextualContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-javascript" ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+xml") ||
    mediaType === "image/svg+xml"
  );
}

function declaredCharset(contentType: string): string {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/iu.exec(contentType);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "utf-8").trim();
}

function errorDetail(error: Error): string {
  return redact(error.message).slice(0, maxGapChars);
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}
