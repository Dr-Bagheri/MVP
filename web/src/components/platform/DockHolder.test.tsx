import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/api/client", () => ({ api: {} }));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/en",
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));

import { DockHolder } from "./PresenceDock";

/**
 * The holder cannot be SEEN without a signed-in member, so its drawing is
 * asserted here: the socket's clip, the rail's two segments, and the
 * active state's colour — the geometry that makes it read as a holder
 * rather than as three unrelated shapes.
 *
 * jsdom zeroes every rect, so the assertions read the inline styles the
 * component computes — those ARE its geometry.
 */

const SOCKET = 64;

function parts(container: HTMLElement) {
  const spans = [...container.querySelectorAll("span")];
  expect(spans, "rail-above, socket, rail-below").toHaveLength(3);
  const [above, socket, below] = spans as [HTMLElement, HTMLElement, HTMLElement];
  return { above, socket, below };
}

describe("the orb's holder", () => {
  it("draws a 64px socket with 30% of it clipped off the edge", () => {
    const { container } = render(<DockHolder side="left" y={400} active={false} />);
    const { socket } = parts(container);
    expect(socket.style.width).toBe(`${SOCKET}px`);
    expect(socket.style.height).toBe(`${SOCKET}px`);
    /* centre 13px in, radius 32 → the circle starts 19px OFF-screen:
       that overhang is the "70% visible" the directive asked for */
    expect(socket.style.left).toBe(`${13 - SOCKET / 2}px`);
  });

  it("mirrors to the right edge by the same measure", () => {
    const { container } = render(<DockHolder side="right" y={400} active={false} />);
    const { socket } = parts(container);
    expect(socket.style.right).toBe(`${13 - SOCKET / 2}px`);
    expect(socket.style.left).toBe("");
  });

  it("runs the rail from the top bar to the socket, and the socket to the page end", () => {
    const y = 400;
    const { container } = render(<DockHolder side="left" y={y} active={false} />);
    const { above, below } = parts(container);
    // container starts under the 56px bar; the gap above the socket is
    // (y - 56) - radius - 6 breathing room
    expect(above.style.top).toBe("0px");
    expect(above.style.height).toBe(`${y - 56 - SOCKET / 2 - 6}px`);
    // the lower rail is anchored to BOTH the socket and the page bottom —
    // "until the end of the page" is the bottom anchor, not a height
    expect(below.style.top).toBe(`${y - 56 + SOCKET / 2 + 6}px`);
    expect(below.style.bottom).toBe("0px");
  });

  it("keeps the socket clear of the top bar however high the pointer goes", () => {
    const { container } = render(<DockHolder side="left" y={0} active={false} />);
    const { above } = parts(container);
    // clamped to 120: the rail above is 120-56-32-6 = 26px, never negative
    expect(above.style.height).toBe("26px");
  });

  it("lights up when the pointer is inside the dock zone", () => {
    const quiet = render(<DockHolder side="left" y={400} active={false} />);
    const lit = render(<DockHolder side="left" y={400} active />);
    const quietSocket = parts(quiet.container).socket;
    const litSocket = parts(lit.container).socket;
    expect(quietSocket.style.borderColor).not.toBe(litSocket.style.borderColor);
    expect(litSocket.style.borderColor).toContain("--accent");
    expect(litSocket.style.boxShadow).not.toBe("none");
  });

  it("is pointer-transparent — a drop is decided by the release, not by this drawing", () => {
    const { container } = render(<DockHolder side="left" y={400} active />);
    expect((container.firstElementChild as HTMLElement).className).toContain("pointer-events-none");
  });
});
