import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Two reads the client used to make ONCE and call complete (2026-09-06):
 *
 *  - the transcript: core bounds a read at 500 segments by default, 2000 at
 *    most, and `getTranscript` asked once with no bound — a long meeting
 *    stopped mid-sentence with nothing on screen saying so;
 *  - the board: `taskBoard({ seed: false })` must reach core as `seed=0`,
 *    or the agents' column listing goes on creating columns on an empty
 *    board — a read that writes.
 */
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

let calls: string[] = [];
afterEach(() => vi.unstubAllGlobals());

async function freshClient() {
  vi.resetModules();
  return (await import("./client")) as typeof import("./client");
}

function stubFetch(handler: (path: string) => Response): void {
  calls = [];
  vi.stubGlobal("fetch", (path: string) => Promise.resolve(handler(path)));
  vi.stubGlobal("fetch", (path: string) => { calls.push(path); return Promise.resolve(handler(path)); });
}

const segment = (i: number) => ({
  id: `seg-${i}`, seq: i, part_id: null, start_ms: i * 1000, end_ms: i * 1000 + 900,
  call_speaker_id: null, channel: null, text: `line ${i}`, words: null, edited: false,
});

describe("getTranscript reads the whole transcript", () => {
  it("pages by time until a short page, and drops the boundary segment the server re-serves", async () => {
    const first = Array.from({ length: 2000 }, (_, i) => segment(i));
    /* the second page starts at the last segment's end and re-serves it
       (`end_ms >= from_ms`) — the id set must drop that one */
    const second = [segment(1999), segment(2000), segment(2001)];
    stubFetch((path) => {
      const url = new URL(path, "http://x");
      return jsonResponse(200, {
        call_id: "c-1",
        segments: url.searchParams.get("from_ms") === null ? first : second,
      });
    });
    const { api } = await freshClient();
    const rows = await api.getTranscript("c-1");
    expect(rows).toHaveLength(2002);
    expect(rows[rows.length - 1]!.id).toBe("seg-2001");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("limit=2000");
    expect(calls[1]).toContain("from_ms=1999900");
    expect(new Set(rows.map((r) => r.id)).size, "no duplicates across the boundary").toBe(2002);
  });

  it("THE CONTROL: a short transcript is one read", async () => {
    stubFetch(() => jsonResponse(200, { call_id: "c-1", segments: [segment(0), segment(1)] }));
    const { api } = await freshClient();
    expect(await api.getTranscript("c-1")).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });
});

describe("taskBoard's seed flag", () => {
  it("`seed: false` reaches the wire as seed=0; the screen's read carries no flag", async () => {
    stubFetch(() => jsonResponse(200, { columns: [], topics: [], tasks: [] }));
    const { api } = await freshClient();
    await api.taskBoard({ seed: false });
    await api.taskBoard();
    expect(calls[0]).toBe("/api/tasks/board?seed=0");
    expect(calls[1]).toBe("/api/tasks/board");
  });
});
