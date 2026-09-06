import { describe, expect, it, vi } from "vitest";

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

function relay(extra: Parameters<typeof createLiveStt>[0] = {}) {
  FakeWs.instances.length = 0;
  return createLiveStt({ apiKey: "sk-test", wsCtor: FakeWs, idleMs: 60_000, ...extra });
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
    // speakers ride the RECORDING lane (2026-08-26)
    expect(config.enable_speaker_diarization).toBe(true);
  });

  it("does NOT diarize the wake-word lane", () => {
    /* the discriminating pair: the same relay, the other format, and the
       flag must be absent — a diarization flag that is simply always on
       would pass the test above and quietly bill every idle minute of the
       always-listening lane */
    const stt = relay();
    stt.start(OWNER, "pcm16k");
    const ws = FakeWs.instances[0]!;
    ws.open();
    const config = JSON.parse(ws.sent[0] as string) as Record<string, unknown>;
    expect(config.audio_format).toBe("pcm_s16le");
    expect(config.enable_speaker_diarization).toBeUndefined();
  });

  it("carries the provider's speaker label through, as a string", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: unknown[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event));
    // the provider spells it as a NUMBER (proven on the live probe:
    // speakers "1", "2", "3"); the wire carries one spelling
    ws.fire("message", { data: JSON.stringify({ tokens: [{ text: "سلام", is_final: true, speaker: 2 }] }) });
    expect(seen).toEqual([
      { type: "tokens", tokens: [{ text: "سلام", is_final: true, speaker: "2" }] },
    ]);
  });

  it("a token with no speaker carries NO speaker field", () => {
    /* absent must stay absent: a defaulted label would make "nobody was
       identified" indistinguishable from "one person spoke" for every
       consumer downstream */
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: { tokens: { speaker?: string }[] }[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event as never));
    ws.fire("message", { data: JSON.stringify({ tokens: [{ text: "hi", is_final: true }] }) });
    expect(seen[0]!.tokens[0]!).not.toHaveProperty("speaker");
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

  it("the TICKET is a whole authority: right one works, wrong/empty are no-session", () => {
    const stt = relay();
    const { session_id, ticket } = stt.start(OWNER);
    FakeWs.instances[0]!.open();
    expect(ticket.length).toBeGreaterThan(10);
    expect(stt.pushAudioByTicket(session_id, ticket, new Uint8Array([1]))).toBe(true);
    expect(stt.pushAudioByTicket(session_id, "wrong", new Uint8Array([1]))).toBe(false);
    // empty must NEVER match — a session with an empty ticket would be open
    expect(stt.pushAudioByTicket(session_id, "", new Uint8Array([1]))).toBe(false);
    expect(stt.subscribeByTicket(session_id, ticket, () => undefined)).not.toBeNull();
    expect(stt.subscribeByTicket(session_id, "wrong", () => undefined)).toBeNull();
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


/**
 * THE CHURN OF 2026-09-05/06 (production): the provider socket failed on
 * every session for ten hours, the browser reopened one every 400ms, and the
 * api log filled with 77,190 "write after end" errors and NOT ONE line that
 * named the provider. Two facts pinned here: a reaped session delivers
 * nothing after its `closed` (the late provider event was the write into the
 * ended response), and every end tells the log WHY, code included, message
 * never.
 */
describe("the relay after the end (2026-09-06)", () => {
  it("a reaped session is silent — a late provider error never reaches the reader", () => {
    const r = relay();
    const { session_id } = r.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: string[] = [];
    r.subscribe(session_id, OWNER, (event) => seen.push(event.type));
    ws.fire("close", {});           // the socket died: reap → closed
    ws.fire("error", {});           // undici's late error on a failed handshake
    ws.fire("message", { data: JSON.stringify({ tokens: [{ text: "x", is_final: true }] }) });
    expect(seen).toEqual(["closed"]);
  });

  it("the log hears the reason and the code of a provider error — never its message", () => {
    const warn = vi.fn();
    const info = vi.fn();
    const r = relay({ log: { info, warn } });
    const { session_id } = r.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    r.subscribe(session_id, OWNER, () => undefined);
    ws.fire("message", { data: JSON.stringify({ error_code: 402, error_message: "the audio said: secret" }) });
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = warn.mock.calls[0]!;
    expect(msg).toBe("live_stt_session_ended");
    expect(fields).toMatchObject({ reason: "provider_error", code: "402", format: "auto" });
    expect(JSON.stringify(fields)).not.toContain("secret");
    expect(info).not.toHaveBeenCalled();
  });

  it("a failed provider socket is a WARN with its own reason; a client stop is an INFO", () => {
    const warn = vi.fn();
    const info = vi.fn();
    const r = relay({ log: { info, warn } });
    const a = r.start(OWNER);
    FakeWs.instances[0]!.fire("error", {});
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "provider_socket" }), "live_stt_session_ended");
    const b = r.start(OWNER);
    FakeWs.instances[1]!.open();
    r.stop(b.session_id, OWNER);
    FakeWs.instances[1]!.fire("close", {});
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ reason: "stopped" }), "live_stt_session_ended");
    expect(a.session_id).not.toBe(b.session_id);
  });

  it("the oldest yielding to the per-user cap is logged as 'cap', not as a fault", () => {
    const warn = vi.fn();
    const info = vi.fn();
    const r = relay({ log: { info, warn }, maxPerUser: 1 });
    r.start(OWNER);
    r.start(OWNER);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ reason: "cap" }), "live_stt_session_ended");
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * C1 on the live lane (2026-09-06): the recognition context rides the
 * provider's config message when the route hands one over, in the
 * provider's own shape — and is ABSENT otherwise, which is the half that
 * keeps "context is always sent" from passing.
 */
describe("recognition context on the live lane", () => {
  it("sends terms, text and general facts in the config, and nothing for an empty context", () => {
    const stt = relay();
    stt.start(OWNER, undefined, { terms: ["نورای", "سینا"], text: "kickoff", general: [{ key: "organization", value: "Neurai" }] });
    const ws = FakeWs.instances[0]!;
    ws.open();
    const config = JSON.parse(ws.sent[0] as string) as Record<string, unknown>;
    expect(config.context).toEqual({ terms: ["نورای", "سینا"], text: "kickoff", general: [{ key: "organization", value: "Neurai" }] });

    const bare = relay();
    bare.start(OWNER, undefined, { terms: [] });
    const ws2 = FakeWs.instances[0]!;
    ws2.open();
    expect("context" in (JSON.parse(ws2.sent[0] as string) as Record<string, unknown>)).toBe(false);
  });

  it("carries a token's language to the caption and never invents one", () => {
    const stt = relay();
    const { session_id } = stt.start(OWNER);
    const ws = FakeWs.instances[0]!;
    ws.open();
    const seen: unknown[] = [];
    stt.subscribe(session_id, OWNER, (event) => seen.push(event));
    ws.fire("message", { data: JSON.stringify({ tokens: [
      { text: "سلام", is_final: true, language: "fa" },
      { text: " ok", is_final: false },
    ] }) });
    expect(seen[0]).toEqual({ type: "tokens", tokens: [
      { text: "سلام", is_final: true, language: "fa" },
      { text: " ok", is_final: false },
    ] });
  });
});
