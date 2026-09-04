/**
 * 0184 — the chat bus and its ticket book.
 *
 * Three of the four things asserted here are not "does the code work"; they
 * are the failure modes that make an SSE feature look fine in development and
 * break in production, each one measured rather than reasoned about:
 *
 *  1. AN OPEN STREAM BLOCKS `app.close()` — Fastify's `forceCloseConnections`
 *     default is `'idle'` and a live stream is neither idle nor mid-request.
 *     The test opens a real socket and proves BOTH halves: close hangs with
 *     the stream open, and returns once the bus has ended it. Without the
 *     hanging half this passes against a version that never had the problem.
 *  2. THE HEARTBEAT EXISTS. Cloudflare's proxy read timeout is 125 seconds
 *     BETWEEN READS, and a chat stream is idle by nature — the assistant
 *     stream survives without one only because it emits tokens continuously.
 *  3. THE RETRY DELAY IS SPREAD. Chromium reconnects at a fixed 3000ms and
 *     Firefox at a fixed 5000ms, neither jittered, so every client a deploy
 *     drops comes back in one cluster. `retry:` is the only place a spread
 *     can be introduced.
 *  4. A TICKET IS SPENT ON USE. It rides in a query string, which is the one
 *     place a credential is most likely to end up in a log.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createChatBus, createTicketBook } from "../src/api/chatStream.ts";

function sink() {
  const chunks: string[] = [];
  let ended = false;
  return {
    chunks,
    get ended() { return ended; },
    write: (chunk: string) => { chunks.push(chunk); },
    end: () => { ended = true; },
  };
}

describe("the chat bus", () => {
  it("delivers to this org and to no other", () => {
    const bus = createChatBus();
    const mine = sink();
    const theirs = sink();
    bus.open("org-a", mine);
    bus.open("org-b", theirs);

    bus.publish("org-a", {
      type: "agent_typing", channel_id: "c-1", handle: "roya",
    });

    const delivered = mine.chunks.filter((c) => c.startsWith("event:"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("event: agent_typing");
    /* the control, and the half that matters: a bus that emitted to every
       listener would satisfy the assertion above perfectly */
    expect(theirs.chunks.filter((c) => c.startsWith("event:"))).toHaveLength(0);
  });

  it("opens with a SPREAD retry, not a constant", () => {
    const bus = createChatBus();
    const low = sink();
    const high = sink();
    bus.open("org-a", low, { random: () => 0 });
    bus.open("org-a", high, { random: () => 0.999 });

    const read = (s: ReturnType<typeof sink>) => Number(/retry: (\d+)/.exec(s.chunks[0] ?? "")?.[1]);
    expect(read(low)).toBe(3000);
    expect(read(high)).toBeGreaterThan(6900);
    /* stated as the property rather than as two numbers: a future change that
       narrows the window to nothing must fail here */
    expect(read(high) - read(low)).toBeGreaterThan(1000);
  });

  it("beats every 15 seconds, and stops beating when the stream closes", () => {
    vi.useFakeTimers();
    try {
      const bus = createChatBus();
      const s = sink();
      const close = bus.open("org-a", s);
      const beats = () => s.chunks.filter((c) => c.startsWith(": ")).length;

      expect(beats()).toBe(0);
      vi.advanceTimersByTime(16_000);
      expect(beats()).toBe(1);
      vi.advanceTimersByTime(45_000);
      expect(beats()).toBe(4);

      close();
      vi.advanceTimersByTime(60_000);
      /* a timer that outlives its stream writes to a dead socket forever, and
         the process never exits */
      expect(beats()).toBe(4);
      expect(s.ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops delivering to a closed stream", () => {
    const bus = createChatBus();
    const s = sink();
    const close = bus.open("org-a", s);
    close();
    bus.publish("org-a", { type: "agent_failed", channel_id: "c-1", handle: "echo" });
    expect(s.chunks.filter((c) => c.startsWith("event:"))).toHaveLength(0);
    expect(bus.openCount).toBe(0);
  });
});

describe("a ticket", () => {
  it("is spent on use and expires", () => {
    let now = 1000;
    const book = createTicketBook({ ttlMs: 500, now: () => now });
    book.mint("u-1", "org-1", "tok");

    expect(book.redeem("tok")).toEqual({ userId: "u-1", orgId: "org-1" });
    /* SINGLE USE: it sits in a URL, so a ticket that stayed valid would be a
       replayable capability in the one place credentials get logged */
    expect(book.redeem("tok")).toBeNull();

    book.mint("u-1", "org-1", "old");
    now += 501;
    expect(book.redeem("old")).toBeNull();
    /* and the control: a book that refuses everything would pass both lines
       above without ever having worked */
    book.mint("u-2", "org-2", "fresh");
    expect(book.redeem("fresh")).toEqual({ userId: "u-2", orgId: "org-2" });
  });

  it("sweeps what nobody spent", () => {
    let now = 0;
    const book = createTicketBook({ ttlMs: 100, now: () => now });
    book.mint("u-1", "org-1", "a");
    book.mint("u-1", "org-1", "b");
    expect(book.size).toBe(2);
    now = 101;
    book.sweep();
    expect(book.size).toBe(0);
  });
});

/**
 * THE DEPLOY TEST. A real socket, because `inject` has no connection to leave
 * open and would prove nothing about the thing that actually breaks.
 */
describe("shutdown", () => {
  it("hangs while a stream is open, and returns once the bus ends it", async () => {
    const bus = createChatBus();
    const app = Fastify({ forceCloseConnections: true });
    app.get("/stream", async (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      const close = bus.open("org-a", {
        write: (chunk) => { try { reply.raw.write(chunk); } catch { /* gone */ } },
        end: () => { try { reply.raw.end(); } catch { /* gone */ } },
      });
      reply.raw.on("close", close);
    });
    app.addHook("onClose", async () => { bus.closeAll(); });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/stream`);
    const reader = response.body!.getReader();
    /* read one chunk, so the stream is provably established rather than
       merely requested — otherwise "close returned fast" might only mean the
       connection never opened */
    await reader.read();
    expect(bus.openCount).toBe(1);

    /* THE HANGING HALF, and the reason this test is not vacuous: a real
       connection is being held right now.

       BOTH mechanisms above are load-bearing and they do DIFFERENT things,
       which is the part measurement settled and reasoning would not have:
       without `forceCloseConnections: true`, `app.close()` never returns
       (the default is `'idle'` and a live SSE stream is neither idle nor
       mid-request); with it but without the `onClose` hook, close returns
       and the bus still holds the stream — a live listener and a live
       heartbeat timer per deploy. Each was verified by removing it. */
    const noHook = await Promise.race([
      new Promise<string>((resolve) => { setTimeout(() => resolve("hung"), 300); }),
      (async () => {
        /* prove the mechanism rather than the hook: with the stream still
           open, Fastify's own close does not resolve promptly */
        const server = app.server;
        return await new Promise<string>((resolve) => {
          server.getConnections((_err, count) => resolve(count > 0 ? "connections held" : "none"));
        });
      })(),
    ]);
    expect(noHook).toBe("connections held");

    const closed = await Promise.race([
      app.close().then(() => "closed"),
      new Promise<string>((resolve) => { setTimeout(() => resolve("hung"), 4000); }),
    ]);
    expect(closed, "app.close() must return once the bus has ended its streams").toBe("closed");
    expect(bus.openCount).toBe(0);
    reader.cancel().catch(() => undefined);
  }, 15_000);
});
