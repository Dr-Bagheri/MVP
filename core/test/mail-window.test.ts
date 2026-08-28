import { describe, expect, it } from "vitest";
import { createConnectorsRepo } from "../src/api/connectors.ts";
import type { ConnectorItem } from "../src/api/connectors.ts";
import type { Db } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * **Which messages count as new** (0119).
 *
 * The poller's window is one page of the inbox and its mark is a message id.
 * That works exactly until the marked message leaves the page — which is not
 * an edge case, it is the SUCCESS case: the person archives the mail we
 * drafted for and the mark is gone the next round.
 *
 * On 2026-08-28 the window narrowed to INBOX, the stored mark was a message
 * outside it, and the fallback branch ("take the page") drafted replies to
 * three hours-old messages. Both neighbouring behaviours are worse than the
 * fix, so both are pinned here as controls: taking the page is the defect,
 * taking nothing would make an ordinary archive look like a dead poller.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member", isActive: true,
};

/** The repo only touches the db for tokens; the window logic touches none. */
const NO_DB = {} as unknown as Db;

function item(id: string, iso: string | null): ConnectorItem {
  return { id, title: id, subtitle: "someone@example.com", occurred_at: iso };
}

/** Newest first, the order both providers return. */
const PAGE = [
  item("m5", "2026-08-28T10:00:00Z"),
  item("m4", "2026-08-28T09:00:00Z"),
  item("m3", "2026-08-28T08:00:00Z"),
  item("m2", "2026-08-28T07:00:00Z"),
];

function repoOver(page: ConnectorItem[]) {
  const repo = createConnectorsRepo(NO_DB);
  /* the window logic is what is under test — the provider call is not */
  repo.mailMessages = async () => page;
  return repo;
}

describe("newMailSince", () => {
  it("takes everything above the mark when the mark is still in the window", async () => {
    const { items, newest, newestAt } = await repoOver(PAGE)
      .newMailSince(IDENTITY, "google", "m3", new Date("2026-08-28T08:00:00Z"));
    expect(items.map((i) => i.id)).toEqual(["m5", "m4"]);
    expect(newest).toBe("m5");
    expect(newestAt?.toISOString()).toBe("2026-08-28T10:00:00.000Z");
  });

  it("drafts nothing on the first look, however full the mailbox is", async () => {
    const { items, newest } = await repoOver(PAGE).newMailSince(IDENTITY, "google", null, null);
    expect(items).toEqual([]);
    expect(newest).toBe("m5");
  });

  it("uses the TIME when the marked message has left the window", async () => {
    /*
     * The archive case, and the one that misfired in production. m3 is gone
     * from the page; only the two messages that arrived after it are new.
     * Before 0119 this returned all four — the whole page — and the two old
     * ones each became a drafted reply.
     */
    const page = PAGE.filter((i) => i.id !== "m3");
    const { items } = await repoOver(page)
      .newMailSince(IDENTITY, "google", "m3", new Date("2026-08-28T08:00:00Z"));
    expect(items.map((i) => i.id)).toEqual(["m5", "m4"]);
  });

  it("does not call an undatable message new", async () => {
    /* a `Date:` header is text a sender writes; unreadable must not mean
       recent, because "recent" here spends a model run and writes a reply */
    const page = [item("m9", null), ...PAGE.filter((i) => i.id !== "m3")];
    const { items } = await repoOver(page)
      .newMailSince(IDENTITY, "google", "m3", new Date("2026-08-28T08:00:00Z"));
    expect(items.map((i) => i.id)).toEqual(["m5", "m4"]);
  });

  it("takes nothing when the mark has no time to fall back to", async () => {
    /* a connection marked before 0119: one quiet round, then the mark has a
       time and the next round answers properly */
    const page = PAGE.filter((i) => i.id !== "m3");
    const { items, newest } = await repoOver(page).newMailSince(IDENTITY, "google", "m3", null);
    expect(items).toEqual([]);
    expect(newest).toBe("m5");
  });
});
