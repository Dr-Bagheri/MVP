import { vi } from "vitest";

/**
 * jsdom has no ResizeObserver, and a follow that is keyed on GEOMETRY
 * (lib/threadFollow) has nothing to follow there — so the observer is faked,
 * and the fake is driven by the test: `fire()` is "something changed size",
 * delivered to every observer the code under test created.
 *
 * It does NOT auto-deliver on `observe()` the way a browser does (the first
 * observation of a rendered element is itself a delivery). That is one line
 * less of behaviour hidden inside a stub; the tests that care about the
 * initial settle say so by calling `fire()` themselves.
 *
 * `observed()` is the structural half: it says WHICH elements the code is
 * watching, so a surface test can assert that the thing it just rendered — a
 * consent card, a refusal line — sits inside an element the follow can see.
 * A card outside the watched wrapper is a card that lands below the fold,
 * and that assertion is what fails against the pre-2026-09-06 surfaces,
 * which watched nothing at all.
 */
export function installFakeResizeObserver() {
  const instances: FakeResizeObserver[] = [];

  class FakeResizeObserver {
    readonly observed = new Set<Element>();
    disconnected = false;
    constructor(readonly callback: ResizeObserverCallback) {
      instances.push(this);
    }
    observe(target: Element): void {
      this.observed.add(target);
    }
    unobserve(target: Element): void {
      this.observed.delete(target);
    }
    disconnect(): void {
      this.observed.clear();
      this.disconnected = true;
    }
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  return {
    /** every element some live observer is watching right now */
    observed: (): Element[] =>
      instances.filter((i) => !i.disconnected).flatMap((i) => [...i.observed]),
    /** "the box or its content changed size" — one delivery to every live observer */
    fire: (): void => {
      for (const i of instances) {
        if (!i.disconnected) i.callback([], i as unknown as ResizeObserver);
      }
    },
    instances,
    uninstall: (): void => {
      vi.unstubAllGlobals();
    },
  };
}
