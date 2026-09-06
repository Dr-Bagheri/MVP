import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeResizeObserver } from "@/test/resizeObserver";
import { useThreadFollow, type ThreadFollow } from "./threadFollow";

/**
 * THE FOLLOW IS KEYED ON GEOMETRY (user report, 2026-09-06: a reply, a
 * consent card, a refusal line each landed below the fold and stayed there).
 *
 * jsdom lays nothing out, so the observer is faked and the test says when
 * "something changed size". What the test can then hold is the whole of the
 * mechanism's contract: which elements are watched, that a delivery while
 * pinned writes the box to its bottom, that a delivery after the reader
 * scrolled up writes NOTHING (the control — a hook that always scrolls
 * satisfies every positive line here and is the "fighting" bug), that the
 * reader's own act re-pins, and that the page-follow reaches an ancestor
 * only when the box itself cannot scroll.
 */
function Harness({
  followPage,
  onReady,
}: {
  followPage?: boolean;
  onReady: (follow: ThreadFollow) => void;
}) {
  const follow = useThreadFollow(followPage === undefined ? {} : { followPage });
  onReady(follow);
  return (
    <div data-testid="box" ref={follow.scrollerRef} onScroll={follow.onScroll}>
      <div data-testid="content" ref={follow.contentRef}>
        <p>سلام</p>
      </div>
    </div>
  );
}

/** the metrics jsdom will never compute, stated; the WRITES are the observable */
function instrument(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  const writes: number[] = [];
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value; writes.push(value); },
  });
  return { writes, setTop: (value: number) => { top = value; } };
}

describe("useThreadFollow — the thread follows what changes size, while the reader is at the bottom", () => {
  let ro: ReturnType<typeof installFakeResizeObserver>;
  let follow: ThreadFollow | null = null;

  beforeEach(() => {
    ro = installFakeResizeObserver();
    follow = null;
  });
  afterEach(() => {
    ro.uninstall();
  });

  function mount(followPage?: boolean) {
    const view = render(<Harness followPage={followPage} onReady={(f) => { follow = f; }} />);
    const box = view.getByTestId("box");
    const content = view.getByTestId("content");
    return { view, box, content };
  }

  it("watches the box AND the one element that wraps its content — had something to check", () => {
    const { box, content } = mount();
    const watched = ro.observed();
    expect(watched).toContain(box);
    expect(watched).toContain(content);
    expect(watched.length).toBe(2);
  });

  it("a size change while pinned puts the box at its bottom — a position, written once per delivery", () => {
    const { box } = mount();
    const { writes } = instrument(box, { scrollHeight: 1000, clientHeight: 400 });
    act(() => { ro.fire(); });
    expect(writes).toEqual([1000]);
    /* whichever side moved: the content grew (a delta, a card) or the box
       shrank (the composer grew, the floor chip appeared) — the callback
       does not care which, and that is the point of keying on geometry */
    Object.defineProperty(box, "scrollHeight", { value: 1300, configurable: true });
    act(() => { ro.fire(); });
    expect(writes).toEqual([1000, 1300]);
  });

  it("THE CONTROL: once the reader has scrolled up, a size change writes nothing", () => {
    const { box } = mount();
    const { writes, setTop } = instrument(box, { scrollHeight: 1000, clientHeight: 400 });
    // 500px above the bottom — re-reading something older
    setTop(100);
    fireEvent.scroll(box);
    act(() => { ro.fire(); });
    act(() => { ro.fire(); });
    expect(writes).toEqual([]);
  });

  it("returning to the bottom by hand re-pins — the scroll handler is the decision, recomputed every time", () => {
    const { box } = mount();
    const { writes, setTop } = instrument(box, { scrollHeight: 1000, clientHeight: 400 });
    setTop(100);
    fireEvent.scroll(box);
    act(() => { ro.fire(); });
    expect(writes).toEqual([]);
    // 590: ten pixels from the bottom, inside the streaming threshold
    setTop(590);
    fireEvent.scroll(box);
    act(() => { ro.fire(); });
    expect(writes).toEqual([1000]);
  });

  it("repin — the reader's own act — goes to the bottom now and follows again afterwards", () => {
    const { box } = mount();
    const { writes, setTop } = instrument(box, { scrollHeight: 1000, clientHeight: 400 });
    setTop(100);
    fireEvent.scroll(box);
    act(() => { ro.fire(); });
    expect(writes).toEqual([]);
    act(() => { follow!.repin(); });
    expect(writes).toEqual([1000]);
    act(() => { ro.fire(); });
    expect(writes).toEqual([1000, 1000]);
  });

  it("followPage: brings the content's end into view ONLY while the box itself cannot scroll", () => {
    const { box, content } = mount(true);
    const into = vi.spyOn(content, "scrollIntoView");
    // the mobile shape: the box grew with its content, nothing overflows
    instrument(box, { scrollHeight: 400, clientHeight: 400 });
    act(() => { ro.fire(); });
    expect(into).toHaveBeenCalledTimes(1);
    expect(into).toHaveBeenCalledWith({ block: "end" });
    // md+: the box overflows and is the scroller — an ancestor must never move
    Object.defineProperty(box, "scrollHeight", { value: 1000, configurable: true });
    act(() => { ro.fire(); });
    expect(into).toHaveBeenCalledTimes(1);
  });

  it("without followPage the page is never touched, even when the box cannot scroll — the room and the panel", () => {
    const { box, content } = mount();
    const into = vi.spyOn(content, "scrollIntoView");
    instrument(box, { scrollHeight: 400, clientHeight: 400 });
    act(() => { ro.fire(); });
    act(() => { follow!.repin(); });
    expect(into).not.toHaveBeenCalled();
  });

  it("unmounting disconnects the observer — a box that is gone is not written to", () => {
    const { view } = mount();
    expect(ro.instances.length).toBe(1);
    view.unmount();
    expect(ro.instances[0]!.disconnected).toBe(true);
    expect(ro.observed()).toEqual([]);
  });

  it("without a ResizeObserver (jsdom's default) it mounts, follows nothing by itself, and repin still writes", () => {
    ro.uninstall();
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe("undefined");
    const { box } = mount();
    const { writes } = instrument(box, { scrollHeight: 1000, clientHeight: 400 });
    expect(writes).toEqual([]);
    act(() => { follow!.repin(); });
    expect(writes).toEqual([1000]);
  });
});
