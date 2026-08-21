import { describe, expect, it } from "vitest";

import { createLiveStt, type WsLike } from "../src/api/live-stt.ts";

/**
 * M38's unit layer: the relay against a fake provider socket. The LIVE
 * half (a real Persian WAV through the real Soniox realtime endpoint,
 * from the server) runs at acceptance via scripts/live-stt-probe.mjs —
 * the risky unknown is the provider contract, and only the wire answers
 * for it. These pin ownership, ordering, and the failure shapes.
 */

class FakeWs implements WsLike {
  static instances: FakeWs[] = [];
  readyState = 0; // CONNECTING
  sent: (string | Uint8Array)[] = [];
  closed = false;
  private listeners = new Map<string, ((event: never) => void)[]>();
  constructor(public url: string) { FakeWs.instances.push(this); }
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(): void { this.closed = true; this.fire("close", {}); }
  addEventListener(type: string, fn: (event: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  fire(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event as never);
  }
  open(): void { this.readyState = 1; this.fire("open", {}); }
}

function relay() {
  FakeWs.instances.length = 0;
  return createLiveStt({ apiKey: "sk-test", wsCtor: FakeWs, idleMs: 60_000 });
}

const OWNER = "u-1";

describe("the live-stt relay (M38)", () => {
  it("is unavailable without a provider key — a nameable nothing", () => {
    expect(createLiveStt({ apiKey: undefined, wsCtor: FakeWs }).available()).toBe(false);
  });

  it("opens the provider socket and sends the config FIRST, key included", () => {
    const stt = relay();
    stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const config = JSON.parse(ws.sent[0] as string) as Record<string, unknown>;
    expect(config.api_key).toBe("sk-test");
    expect(config.audio_format).toBe("auto");
    expect(config.language_hints).toEqual(["fa", "en"]);
  });

  it("audio that races the handshake WAITS for open instead of dropping", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    // still CONNECTING — the recorder's first chunk arrives this early
    expect(stt.pushAudio(session_id, OWNER, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(ws.sent.length).toBe(0);
    ws.open();
    // config first, then the buffered chunk
    expect(ws.sent.length).toBe(2);
    expect(ws.sent[1]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("provider tokens reach the subscriber; queued ones drain first", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    ws.fire("message", { data: JSON.stringify({ tokens: [{ text: "سلام", is_final: true }] }) });
    const seen: unknown[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event));
    ws.fire("message", { data: JSON.stringify({ tokens: [{ text: " دنیا", is_final: false }] }) });
    expect(seen).toEqual([
      { type: "tokens", tokens: [{ text: "سلام", is_final: true }] },
      { type: "tokens", tokens: [{ text: " دنیا", is_final: false }] },
    ]);
  });

  it("a foreign user's touch is indistinguishable from no session", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    FakeWs.instances[0]!.open();
    expect(stt.pushAudio(session_id, "u-2", new Uint8Array([1]))).toBe(false);
    expect(stt.subscribe(session_id, "u-2", () => undefined)).toBeNull();
    expect(stt.stop(session_id, "u-2")).toBe(false);
    expect(stt.pushAudio("not-a-session", OWNER, new Uint8Array([1]))).toBe(false);
  });

  it("stop sends the provider's end-of-audio (empty string), close reaps", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: { type: string }[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event));
    stt.stop(session_id, OWNER);
    expect(ws.sent.at(-1)).toBe("");
    ws.fire("close", {});
    expect(seen.at(-1)).toEqual({ type: "closed" });
    expect(stt.liveSessions()).toBe(0);
  });

  it("a provider error surfaces as a CODE — never the message, which can quote audio", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: { type: string; code?: string }[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event));
    ws.fire("message", { data: JSON.stringify({ error_code: 401, error_message: "secret detail" }) });
    expect(seen[0]).toEqual({ type: "error", code: "401" });
    expect(JSON.stringify(seen)).not.toContain("secret detail");
  });

  it("a fourth session reaps the caller's OLDEST — a refresh cannot brick the lane", () => {
    const stt = relay();
    const first = stt.start(OWNER);
    stt.start(OWNER);
    stt.start(OWNER);
    stt.start(OWNER);
    expect(stt.liveSessions()).toBe(3);
    expect(stt.pushAudio(first.session_id, OWNER, new Uint8Array([1]))).toBe(false);
  });
});
