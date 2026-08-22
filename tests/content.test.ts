import { describe, expect, it } from "vitest";
import { startContentCapture } from "../src/checks/content";

const origin = "http://127.0.0.1:3000";
type CdpValue = string | number | boolean | null | readonly CdpValue[] | CdpPayload;
type CdpPayload = { readonly [key: string]: CdpValue };

class FakeCdpSession {
  readonly calls: string[] = [];
  readonly streamBodies = new Map<string, string>();
  failStream = false;
  streamFailuresRemaining = 0;
  hangStream = false;
  failContinue = false;
  hangContinue = false;
  detached = false;
  private readonly listeners = new Map<string, Array<(event: CdpPayload) => void>>();

  on(event: string, listener: (event: CdpPayload) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, value: CdpPayload): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  async send(
    method:
      | "Network.enable"
      | "Network.streamResourceContent"
      | "Fetch.enable"
      | "Fetch.continueRequest"
      | "Fetch.disable"
      | "Network.disable",
    params?: CdpPayload,
  ): Promise<CdpPayload> {
    this.calls.push(method);
    if (method === "Network.streamResourceContent") {
      if (this.streamFailuresRemaining > 0) {
        this.streamFailuresRemaining -= 1;
        throw new Error("stream failed");
      }
      if (this.failStream) throw new Error("stream failed");
      if (this.hangStream) return new Promise(() => undefined);
      return { bufferedData: this.streamBodies.get(String(params?.requestId)) ?? "" };
    }
    if (method === "Fetch.continueRequest") {
      if (this.failContinue) throw new Error("continue failed");
      if (this.hangContinue) return new Promise(() => undefined);
    }
    return {};
  }

  async detach(): Promise<void> {
    this.detached = true;
  }
}

function request(
  session: FakeCdpSession,
  requestId: string,
  path: string,
  contentType = "text/plain",
): void {
  const url = `${origin}${path}`;
  session.emit("Network.requestWillBeSent", {
    requestId,
    request: { url },
  });
  session.emit("Fetch.requestPaused", {
    requestId: `fetch-${requestId}`,
    networkId: requestId,
    request: { url },
    responseStatusCode: 200,
  });
  session.emit("Network.responseReceived", {
    requestId,
    response: {
      url,
      status: 200,
      mimeType: contentType.split(";", 1)[0] ?? contentType,
      headers: { "content-type": contentType },
    },
  });
}

function finishRequest(session: FakeCdpSession, requestId: string): void {
  session.emit("Network.loadingFinished", { requestId });
}

describe("bounded content capture", () => {
  it("truncates an oversized body and still detects a prefix finding", async () => {
    const session = new FakeCdpSession();
    const credential = ["sk", "live", "51ABCDEFGHIJKLMNOPQRSTUVWX"].join("_");
    const body = `${credential}${"x".repeat(1_100_000)}`;
    session.streamBodies.set("large", Buffer.from(body).toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "large", "/large.js");
    finishRequest(session, "large");

    const scan = await capture.finish();
    expect(scan.responses[0]).toMatchObject({
      observedBytes: Buffer.byteLength(body),
      disposition: "truncated",
    });
    expect(scan.responses[0]).not.toHaveProperty("digest");
    expect(scan.findings).toHaveLength(1);
    expect(scan.knownGapCount).toBe(1);
  });

  it("detects a credential in a declared UTF-16 response", async () => {
    const session = new FakeCdpSession();
    const credential = ["sk", "live", "51ABCDEFGHIJKLMNOPQRSTUVWX"].join("_");
    const body = Buffer.from(credential, "utf16le");
    session.streamBodies.set("utf-16", body.toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "utf-16", "/utf-16", "text/plain; charset=utf-16le");
    finishRequest(session, "utf-16");

    const scan = await capture.finish();

    expect(scan.findings).toHaveLength(1);
    expect(scan.textDecodingGapCount).toBe(0);
  });

  it("records an unsupported textual encoding as a scanning gap", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("unsupported", Buffer.from("ordinary text").toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "unsupported", "/unsupported", "text/plain; charset=docs-trials-unsupported");
    finishRequest(session, "unsupported");

    const scan = await capture.finish();

    expect(scan.textDecodingGapCount).toBe(1);
    expect(scan.responsesScanned).toBe(0);
    expect(scan.responses[0]).toMatchObject({ disposition: "complete" });
    expect(scan.responses[0]).toHaveProperty("digest");
  });

  it("retains an ASCII credential finding from an unsupported encoding", async () => {
    const session = new FakeCdpSession();
    const credential = ["sk", "live", "51ABCDEFGHIJKLMNOPQRSTUVWX"].join("_");
    session.streamBodies.set("unsupported-finding", Buffer.from(credential).toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(
      session,
      "unsupported-finding",
      "/unsupported-finding",
      "text/plain; charset=docs-trials-unsupported",
    );
    finishRequest(session, "unsupported-finding");

    const scan = await capture.finish();

    expect(scan.findings).toHaveLength(1);
    expect(scan.textDecodingGapCount).toBe(1);
  });

  it("records invalid declared UTF-8 as a scanning gap", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("invalid", Buffer.from([0xc3, 0x28]).toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "invalid", "/invalid", "text/plain; charset=utf-8");
    finishRequest(session, "invalid");

    const scan = await capture.finish();

    expect(scan.textDecodingGapCount).toBe(1);
    expect(scan.responsesScanned).toBe(0);
  });

  it("rejects malformed buffered base64 instead of passing an empty body", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("invalid-base64", "!!!!");
    const capture = await startContentCapture(session, origin);
    request(session, "invalid-base64", "/invalid-base64");
    finishRequest(session, "invalid-base64");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.captureFaultCount).toBeGreaterThan(0);
    expect(scan.responsesScanned).toBe(0);
  });

  it("rejects malformed streamed base64 instead of trusting its encoded length", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    request(session, "invalid-chunk", "/invalid-chunk");
    await Promise.resolve();
    session.emit("Network.dataReceived", {
      requestId: "invalid-chunk",
      dataLength: 3,
      data: "!!!!",
    });
    finishRequest(session, "invalid-chunk");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.captureFaultCount).toBeGreaterThan(0);
    expect(scan.responsesScanned).toBe(0);
  });

  it("enforces the aggregate body budget", async () => {
    const session = new FakeCdpSession();
    const body = Buffer.from("a".repeat(900_000)).toString("base64");
    for (const id of ["a", "b", "c"]) session.streamBodies.set(id, body);
    const capture = await startContentCapture(session, origin);
    for (const id of ["a", "b", "c"]) {
      request(session, id, `/${id}`);
      finishRequest(session, id);
    }

    const scan = await capture.finish();
    expect(scan.responses.some((response) => response.disposition !== "complete")).toBe(true);
    expect(scan.bytesScanned).toBeLessThanOrEqual(2_097_152);
    expect(scan.knownGapCount).toBeGreaterThan(0);
  });

  it("caps response metadata and reports overflow as a capture fault", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    for (let index = 0; index < 129; index += 1) {
      session.emit("Network.requestWillBeSent", {
        requestId: `pending-${index}`,
        request: { url: `${origin}/pending-${index}` },
      });
    }

    const scan = await capture.finish();
    expect(scan.responses).toHaveLength(0);
    expect(scan.knownGapCount).toBe(128);
    expect(scan.captureFaultCount).toBeGreaterThan(0);
    expect(scan.gaps).toHaveLength(3);
  });

  it("caps retained URLs and makes truncation inconclusive", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    request(session, "long", `/${"x".repeat(700)}`);
    finishRequest(session, "long");

    const scan = await capture.finish();
    expect(scan.responses[0]?.url.length).toBeLessThanOrEqual(500);
    expect(scan.captureFaultCount).toBeGreaterThan(0);
  });

  it("rejects oversized request identifiers without retaining state", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    session.emit("Network.requestWillBeSent", {
      requestId: "r".repeat(201),
      request: { url: `${origin}/identifier` },
    });

    const scan = await capture.finish();
    expect(scan.responses).toHaveLength(0);
    expect(scan.knownGapCount).toBe(0);
    expect(scan.captureFaultCount).toBe(1);
  });

  it("records malformed relevant events as capture faults", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    session.emit("Network.responseReceived", { requestId: "broken" });
    session.emit("Network.dataReceived", { requestId: "broken", dataLength: -1 });
    session.emit("Fetch.requestPaused", { requestId: "fetch-broken" });

    const scan = await capture.finish();
    expect(scan.captureFaultCount).toBe(3);
    expect(scan.gaps[0]).toContain("capture fault");
  });

  it("counts observed bytes when streamed data is unavailable", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    request(session, "missing-data", "/missing-data");
    await Promise.resolve();
    session.emit("Network.dataReceived", { requestId: "missing-data", dataLength: 123 });
    finishRequest(session, "missing-data");

    const scan = await capture.finish();
    expect(scan.responses[0]).toMatchObject({ observedBytes: 123, disposition: "unavailable" });
    expect(scan.knownGapCount).toBe(1);
  });

  it("reports a completed same-origin request with no response metadata as a gap", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    session.emit("Network.requestWillBeSent", {
      requestId: "missing-metadata",
      request: { url: `${origin}/missing-metadata` },
    });
    finishRequest(session, "missing-metadata");

    const scan = await capture.finish();

    expect(scan.responses).toHaveLength(0);
    expect(scan.knownGapCount).toBe(1);
    expect(scan.gaps[0]).toContain("unrecorded same-origin response");
  });

  it("preserves the observed byte lower bound when buffered data is incomplete", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("early", Buffer.from("short").toString("base64"));
    const capture = await startContentCapture(session, origin);
    session.emit("Network.requestWillBeSent", {
      requestId: "early",
      request: { url: `${origin}/early` },
    });
    session.emit("Network.dataReceived", { requestId: "early", dataLength: 123 });
    session.emit("Network.responseReceived", {
      requestId: "early",
      response: {
        url: `${origin}/early`,
        status: 200,
        mimeType: "text/plain",
        headers: { "content-type": "text/plain" },
      },
    });
    finishRequest(session, "early");

    const scan = await capture.finish();

    expect(scan.responses[0]).toMatchObject({ observedBytes: 123, disposition: "unavailable" });
  });

  it("adds mixed pre-stream byte observations to the lower bound", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("mixed-early", Buffer.from("short").toString("base64"));
    const capture = await startContentCapture(session, origin);
    session.emit("Network.requestWillBeSent", {
      requestId: "mixed-early",
      request: { url: `${origin}/mixed-early` },
    });
    session.emit("Network.dataReceived", { requestId: "mixed-early", dataLength: 123 });
    const data = Buffer.from("12345678901234567890").toString("base64");
    session.emit("Network.dataReceived", {
      requestId: "mixed-early",
      dataLength: 20,
      data,
    });
    session.emit("Network.responseReceived", {
      requestId: "mixed-early",
      response: {
        url: `${origin}/mixed-early`,
        status: 200,
        mimeType: "text/plain",
        headers: { "content-type": "text/plain" },
      },
    });
    finishRequest(session, "mixed-early");

    const scan = await capture.finish();

    expect(scan.responses[0]).toMatchObject({ observedBytes: 143, disposition: "unavailable" });
  });

  it("scans buffered data before chunks received while stream setup is pending", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("unordered", Buffer.from("sk_live_51ABC").toString("base64"));
    const capture = await startContentCapture(session, origin);
    session.emit("Network.requestWillBeSent", {
      requestId: "unordered",
      request: { url: `${origin}/unordered` },
    });
    session.emit("Network.dataReceived", {
      requestId: "unordered",
      dataLength: Buffer.byteLength("sk_live_51ABC"),
    });
    const data = Buffer.from("DEFGHIJKLMNOPQRSTUVWX").toString("base64");
    session.emit("Network.dataReceived", {
      requestId: "unordered",
      dataLength: Buffer.byteLength("DEFGHIJKLMNOPQRSTUVWX"),
      data,
    });
    session.emit("Network.responseReceived", {
      requestId: "unordered",
      response: {
        url: `${origin}/unordered`,
        status: 200,
        mimeType: "text/plain",
        headers: { "content-type": "text/plain" },
      },
    });
    session.emit("Fetch.requestPaused", {
      requestId: "fetch-unordered",
      networkId: "unordered",
      request: { url: `${origin}/unordered` },
      responseStatusCode: 200,
    });
    finishRequest(session, "unordered");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("complete");
    expect(scan.findings).toHaveLength(1);
  });

  it("does not duplicate activation-boundary data returned as buffered content", async () => {
    const session = new FakeCdpSession();
    const body = Buffer.from("complete response body");
    session.streamBodies.set("overlap", body.toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "overlap", "/overlap");
    session.emit("Network.dataReceived", {
      requestId: "overlap",
      dataLength: body.byteLength,
      data: body.toString("base64"),
    });
    finishRequest(session, "overlap");

    const scan = await capture.finish();

    expect(scan.responses[0]).toMatchObject({
      observedBytes: body.byteLength,
      disposition: "complete",
    });
    expect(scan.bytesScanned).toBe(body.byteLength);
  });

  it("turns streaming failure into a response gap", async () => {
    const session = new FakeCdpSession();
    session.failStream = true;
    const capture = await startContentCapture(session, origin);
    request(session, "stream", "/stream");
    finishRequest(session, "stream");

    const scan = await capture.finish();
    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.knownGapCount).toBe(1);
    expect(scan.captureFaultCount).toBe(1);
  });

  it("uses the response pause when response metadata arrives first", async () => {
    const session = new FakeCdpSession();
    session.streamBodies.set("ordered-retry", Buffer.from("complete body").toString("base64"));
    const capture = await startContentCapture(session, origin);
    const url = `${origin}/ordered-retry`;
    session.emit("Network.requestWillBeSent", {
      requestId: "ordered-retry",
      request: { url },
    });
    session.emit("Network.responseReceived", {
      requestId: "ordered-retry",
      response: {
        url,
        status: 200,
        mimeType: "text/plain",
        headers: { "content-type": "text/plain" },
      },
    });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    expect(session.calls).not.toContain("Network.streamResourceContent");
    session.failStream = false;
    session.emit("Fetch.requestPaused", {
      requestId: "fetch-ordered-retry",
      networkId: "ordered-retry",
      request: { url },
      responseStatusCode: 200,
    });
    finishRequest(session, "ordered-retry");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("complete");
    expect(scan.captureFaultCount).toBe(0);
    expect(session.calls.indexOf("Network.streamResourceContent")).toBeLessThan(
      session.calls.indexOf("Fetch.continueRequest"),
    );
  });

  it("retries after continuation when paused streaming fails once", async () => {
    const session = new FakeCdpSession();
    session.streamFailuresRemaining = 1;
    session.streamBodies.set("continued-retry", Buffer.from("complete body").toString("base64"));
    const capture = await startContentCapture(session, origin);
    request(session, "continued-retry", "/continued-retry");
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    finishRequest(session, "continued-retry");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("complete");
    expect(scan.captureFaultCount).toBe(0);
    expect(
      session.calls.filter((method) => method === "Network.streamResourceContent"),
    ).toHaveLength(2);
  });

  it("does not treat partial observed bytes as complete after streaming fails", async () => {
    const session = new FakeCdpSession();
    session.failStream = true;
    const capture = await startContentCapture(session, origin);
    request(session, "partial", "/partial");
    const data = Buffer.from("observed suffix").toString("base64");
    session.emit("Network.dataReceived", {
      requestId: "partial",
      dataLength: Buffer.byteLength("observed suffix"),
      data,
    });
    finishRequest(session, "partial");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.knownGapCount).toBe(1);
  });

  it("bounds hanging operations and tears down the CDP session", async () => {
    const session = new FakeCdpSession();
    session.hangStream = true;
    const capture = await startContentCapture(session, origin, { operationTimeoutMs: 25 });
    request(session, "hanging", "/hanging");
    finishRequest(session, "hanging");

    const started = Date.now();
    const scan = await capture.finish();
    expect(Date.now() - started).toBeLessThan(500);
    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(session.calls).toContain("Network.disable");
    expect(session.detached).toBe(true);
  });

  it("fails closed when an intercepted response cannot continue", async () => {
    const session = new FakeCdpSession();
    session.failContinue = true;
    const capture = await startContentCapture(session, origin);
    request(session, "continue-failure", "/continue-failure");
    finishRequest(session, "continue-failure");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.captureFaultCount).toBe(1);
    expect(session.calls).toContain("Fetch.disable");
  });

  it("bounds a hanging response continuation", async () => {
    const session = new FakeCdpSession();
    session.hangContinue = true;
    const capture = await startContentCapture(session, origin, { operationTimeoutMs: 25 });
    request(session, "continue-timeout", "/continue-timeout");
    finishRequest(session, "continue-timeout");

    const scan = await capture.finish();

    expect(scan.responses[0]?.disposition).toBe("unavailable");
    expect(scan.captureFaultCount).toBe(1);
    expect(session.detached).toBe(true);
  });

  it("caps tracked operations and records overflow", async () => {
    const session = new FakeCdpSession();
    session.hangStream = true;
    const capture = await startContentCapture(session, origin, { operationTimeoutMs: 25 });
    for (let index = 0; index < 140; index += 1) {
      request(session, `operation-${index}`, `/operation-${index}`);
    }

    const scan = await capture.finish();
    const streams = session.calls.filter((method) => method === "Network.streamResourceContent");
    expect(streams.length).toBeLessThanOrEqual(256);
    expect(scan.captureFaultCount).toBeGreaterThan(0);
  });

  it("counts known CDP pending identities without claiming unknown totals", async () => {
    const session = new FakeCdpSession();
    const capture = await startContentCapture(session, origin);
    for (let index = 0; index < 5; index += 1) {
      session.emit("Network.requestWillBeSent", {
        requestId: `pending-${index}`,
        request: { url: `${origin}/pending-${index}` },
      });
    }

    const scan = await capture.finish();
    expect(scan.knownGapCount).toBe(5);
    expect(scan.captureFaultCount).toBe(0);
    expect(scan.gaps).toHaveLength(3);
  });
});
