import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  liveConversation, resetLiveConversationForTest, setLiveConversation,
  subscribeLiveConversation,
} from "./liveConversation";

/**
 * The handoff between the assistant's two surfaces.
 *
 * What this is NOT: a store of the conversation. Both the sidebar and the
 * assistant page already know how to load a thread from an id, and the server
 * holds the messages — keeping a copy here would be two renderers over one
 * array in two message shapes, which is the two-spellings problem at the size
 * of a whole conversation.
 *
 * The assertions are about the two states being DIFFERENT: an id that is
 * handed over, and an absence that means "start fresh". Those two got
 * conflated in the first draft — `setLiveConversation(null)` after a "new
 * conversation" has to actively clear, not merely fail to set, or the page
 * you walk to resumes the thread the button just cleared.
 */
beforeEach(() => {
  sessionStorage.clear();
  resetLiveConversationForTest();
});

describe("the live conversation handoff", () => {
  it("starts with nothing to hand over", () => {
    expect(liveConversation()).toBeNull();
  });

  it("carries an id, and clears on null", () => {
    setLiveConversation("s-1");
    expect(liveConversation()).toBe("s-1");
    /* the "new conversation" case: an ABSENCE, not a special id. A store that
       only ever set would leave the cleared thread waiting on the next
       screen. */
    setLiveConversation(null);
    expect(liveConversation()).toBeNull();
    expect(sessionStorage.getItem("neurai-live-conversation")).toBeNull();
  });

  it("survives a full page load, per TAB", () => {
    /* sessionStorage, not localStorage: two windows on the platform are two
       people's worth of attention, and a shared id would drag one window's
       conversation into the other on every navigation */
    setLiveConversation("s-2");
    /* the reload is staged by dropping the in-memory copy and leaving storage
       standing — NOT by `resetLiveConversationForTest`, which clears both
       halves on purpose (a seam promising a reset must not leave the durable
       one behind). Two different questions, two different setups. */
    resetLiveConversationForTest();
    sessionStorage.setItem("neurai-live-conversation", "s-2");
    expect(liveConversation()).toBe("s-2");
  });

  it("tells subscribers, and says nothing when the value did not move", () => {
    const listener = vi.fn();
    const stop = subscribeLiveConversation(listener);
    setLiveConversation("s-3");
    expect(listener).toHaveBeenCalledTimes(1);
    /* the control: a store that notified unconditionally would satisfy the
       line above and re-render both surfaces on every session event of a
       stream that is already showing that session */
    setLiveConversation("s-3");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setLiveConversation("s-4");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearing an already-empty handoff still counts as a change once", () => {
    /*
     * The edge the no-op guard could get wrong: before anything is read,
     * `current` is null and `hydrated` is false, so "null === current" is true
     * for the wrong reason. Clearing must still hydrate, or the next read
     * would go back to storage and resurrect an id that was just cleared.
     */
    sessionStorage.setItem("neurai-live-conversation", "s-stale");
    resetLiveConversationForTest();
    setLiveConversation(null);
    expect(liveConversation()).toBeNull();
    expect(sessionStorage.getItem("neurai-live-conversation")).toBeNull();
  });

  it("degrades to no handoff when storage refuses", () => {
    /* privacy settings make these throw. The cost is a conversation that does
       not follow — which is the behaviour before this file existed — and never
       an exception on a navigation. */
    const getItem = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => { throw new Error("denied"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("denied"); });
    resetLiveConversationForTest();
    expect(() => liveConversation()).not.toThrow();
    expect(() => setLiveConversation("s-5")).not.toThrow();
    /* and it still works for THIS page's lifetime — the in-memory half is
       what makes the same-tab handoff survive a refusal to persist */
    expect(liveConversation()).toBe("s-5");
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
