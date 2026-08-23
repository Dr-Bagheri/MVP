/**
 * A tiny external store for "a component owns itself; a shell only offers it
 * a visual anchor". First written for the assistant orb (presenceAnchor);
 * extracted when the mini recorder needed the identical shape — the second
 * copy is the one nobody makes.
 */
type AnchorListener = () => void;

export type AnchorStore = {
  register: (anchor: HTMLElement) => () => void;
  subscribe: (listener: AnchorListener) => () => void;
  getSnapshot: () => HTMLElement | null;
  getServerSnapshot: () => null;
};

export function createAnchorStore(): AnchorStore {
  let current: HTMLElement | null = null;
  const listeners = new Set<AnchorListener>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    register(anchor: HTMLElement) {
      if (current !== anchor) {
        current = anchor;
        emit();
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        /* A departing shell must not clear a newer shell's anchor. This
           matters during route transitions where mount and cleanup can
           interleave. */
        if (current === anchor) {
          current = null;
          emit();
        }
      };
    },
    subscribe(listener: AnchorListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    getServerSnapshot: () => null,
  };
}
