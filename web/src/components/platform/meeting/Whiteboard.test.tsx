import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeTheme } from "@/lib/theme";
import { installFakeResizeObserver } from "@/test/resizeObserver";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

const { Whiteboard } = await import("./Whiteboard");

/**
 * THE INK IS A ROLE (user directive, 2026-09-06: "for the whiteboard in the
 * meetings room add bright colours for dark theme and darker colours for
 * light theme — in dark remove the black and the brown and add white, in
 * light remove the white and add black").
 *
 * Two claims, and the second is the one a per-theme palette alone would get
 * wrong: the swatches follow the theme, AND a board drawn under one theme
 * still reads under the other, because what is stored is the role and the hex
 * is resolved when it is drawn. A stored literal would come back invisible.
 *
 * The canvas has no 2D context under jsdom, so the drawing itself is not what
 * is asserted here — the SWATCHES are, which is where the palette is visible
 * to a test and to a person, and the stored shape is read back from the store
 * the component actually writes.
 */
const KEY = "neurai-whiteboard-m-1";
const swatches = () => screen.getAllByRole("button", { name: "wbColor" });
const groundOf = (el: Element) => (el.querySelector("span") as HTMLElement).style.backgroundColor;

beforeEach(() => {
  /* jsdom has none, and the canvas fits itself to its box through one */
  installFakeResizeObserver();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  storeTheme("dark");
});

describe("the whiteboard's palette follows the theme", () => {
  it("offers bright ink on the dark canvas — the first swatch is near-WHITE, and no black or brown", () => {
    storeTheme("dark");
    render(<Whiteboard meetingId="m-1" />);
    const grounds = swatches().map(groundOf);
    expect(grounds).toHaveLength(5);
    /* the default pen: what every board starts on, and what used to draw
       near-black on a near-black canvas */
    expect(grounds[0]).toBe("rgb(242, 239, 233)");
    /* nothing dark enough to vanish: every ink is light on this ground */
    for (const rgb of grounds) {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number) as [number, number, number];
      expect(r + g + b, `${rgb} is too dark for the dark canvas`).toBeGreaterThan(330);
    }
  });

  it("offers dark ink on the light canvas — the first swatch is near-BLACK, and nothing white", () => {
    storeTheme("light");
    render(<Whiteboard meetingId="m-1" />);
    const grounds = swatches().map(groundOf);
    expect(grounds[0]).toBe("rgb(20, 17, 12)");
    for (const rgb of grounds) {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number) as [number, number, number];
      expect(r + g + b, `${rgb} is too light for the light canvas`).toBeLessThan(400);
    }
  });

  it("stores the ROLE, so one board reads in both themes", () => {
    /*
     * The discriminating case. A palette that only changed the swatches would
     * pass both tests above and still store a literal — and a board drawn in
     * dark would come back as white strokes on the light canvas, which is the
     * failure the directive is about, pointed the other way.
     */
    storeTheme("dark");
    render(<Whiteboard meetingId="m-1" />);
    const canvas = document.querySelector("canvas")!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture = () => undefined;

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as { ink?: string; color: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ink, "the stroke remembers WHICH ink, not the hex it was drawn in").toBe("ink");
    /* the literal rides along for a build older than the roles, and it is the
       theme's own — never a value from the other palette */
    expect(stored[0]!.color).toBe("#f2efe9");
  });
});
