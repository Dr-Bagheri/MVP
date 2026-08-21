import { afterEach, describe, expect, it, vi } from "vitest";
import { notify, notifyHistory, resetNotifications, subscribeNotify } from "./notify";

describe("the notification bus", () => {
  afterEach(() => resetNotifications());

  it("delivers a notice to subscribers and keeps it in history", () => {
    const seen = vi.fn();
    subscribeNotify(seen);
    const notice = notify("ذخیره شد");
    expect(seen).toHaveBeenCalledWith(notice);
    expect(notifyHistory()[0]).toEqual(notice);
  });

  it("newest first, capped — the history is a shelf, not a log", () => {
    for (let i = 0; i < 60; i++) notify(`n${i}`);
    const history = notifyHistory();
    expect(history.length).toBe(50);
    expect(history[0]?.text).toBe("n59");
  });

  it("unsubscribe stops delivery — a dead component must not keep hearing", () => {
    const seen = vi.fn();
    const off = subscribeNotify(seen);
    off();
    notify("after");
    expect(seen).not.toHaveBeenCalled();
  });

  it("history returns a copy the caller cannot edit into the record", () => {
    const real = notify("real");
    const copy = notifyHistory();
    copy[0] = { ...real, text: "forged" };
    expect(notifyHistory()[0]?.text).toBe("real");
  });

  it("warn kind travels with the notice", () => {
    expect(notify("مشکلی هست", "warn").kind).toBe("warn");
  });
});
