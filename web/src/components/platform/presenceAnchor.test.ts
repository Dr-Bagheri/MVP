import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPresenceAnchorSnapshot,
  registerPresenceAnchor,
  subscribePresenceAnchor,
} from "./presenceAnchor";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("the platform presence anchor", () => {
  it("publishes the registered target and its removal", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePresenceAnchor(listener);
    cleanups.push(unsubscribe);
    const anchor = document.createElement("div");

    const remove = registerPresenceAnchor(anchor);
    cleanups.push(remove);
    expect(getPresenceAnchorSnapshot()).toBe(anchor);
    expect(listener).toHaveBeenCalledTimes(1);

    remove();
    expect(getPresenceAnchorSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not let stale shell cleanup erase a newer target", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const removeFirst = registerPresenceAnchor(first);
    const removeSecond = registerPresenceAnchor(second);
    cleanups.push(removeFirst, removeSecond);

    removeFirst();
    expect(getPresenceAnchorSnapshot()).toBe(second);

    removeSecond();
    expect(getPresenceAnchorSnapshot()).toBeNull();
  });

  it("ignores unrelated DOM nodes", () => {
    const anchor = document.createElement("div");
    const unrelated = document.createElement("div");
    const remove = registerPresenceAnchor(anchor);
    cleanups.push(remove);

    document.body.appendChild(unrelated);
    try {
      expect(getPresenceAnchorSnapshot()).toBe(anchor);
    } finally {
      unrelated.remove();
    }
  });
});
