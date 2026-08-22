import { describe, expect, it } from "vitest";
import { startContentCapture } from "../src/checks/content";

const origin = "http://127.0.0.1:3000";
type CdpValue = string | number | boolean | null | readonly CdpValue[] | CdpPayload;
type CdpPayload = { readonly [key: string]: CdpValue };

class FakeCdpSession {
  readonly calls: string[] = [];
  readonly streamBodies = new Map<string, string>();
  failContinuation = false;
  hangStream = false;
  hangContinuation = false;
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
      | "Fetch.enable"
      | "Network.streamResourceContent"
      | "Fetch.continueRequest"
      | "Fetch.disable"
      | "Network.disable",
    params?: CdpPayload,
  ): Promise<CdpPayload> {
    this.calls.push(method);
    if (method === "Network.streamResourceContent") {
      if (this.hangStream) return new Promise(() => undefined);
      return { bufferedData: this.streamBodies.get(String(params?.requestId)) ?? "" };
    }
    if (method === "Fetch.continueRequest" && this.failContinuation) {
      throw new Error("continuation failed");
    }
    if (method === "Fetch.continueRequest" && this.hangContinuation) {
      return new Promise(() => undefined);
    }
    return {};
  }

  async detach(): Promise<void> {
    this.detached = true;
  }
}

function request(session: FakeCdpSession, requestId: string, path: string): void {
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
    responseHeaders: [{ name: "content-type", value: "text/plain" }],
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
    expect(session.calls).toContain("Fetch.continueRequest");
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

  it("turns continuation failure into a response gap", async () => {
    const session = new FakeCdpSession();
    session.failContinuation = true;
    const capture = await startContentCapture(session, origin);
    request(session, "continue", "/continue");
    finishRequest(session, "continue");

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
    expect(session.calls).toContain("Fetch.disable");
    expect(session.calls).toContain("Network.disable");
    expect(session.detached).toBe(true);
  });

  it("caps tracked operations and records overflow", async () => {
    const session = new FakeCdpSession();
    session.hangContinuation = true;
    const capture = await startContentCapture(session, origin, { operationTimeoutMs: 25 });
    for (let index = 0; index < 140; index += 1) {
      request(session, `operation-${index}`, `/operation-${index}`);
    }

    const scan = await capture.finish();
    const continuations = session.calls.filter((method) => method === "Fetch.continueRequest");
    expect(continuations.length).toBeLessThanOrEqual(128);
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
