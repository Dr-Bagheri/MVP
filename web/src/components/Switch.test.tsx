import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

/**
 * The three properties that were NOT true of the nine hand-drawn switches
 * this component replaces — which is why each is asserted rather than assumed.
 */
describe("Switch", () => {
  it("reports its state to a screen reader, and calls back when pressed", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="اشتراک با دستیار" />);
    const box = screen.getByRole("switch", { name: "اشتراک با دستیار" });
    expect(box.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    /* it does NOT flip itself: the state belongs to whoever owns the value, so
       a refused write leaves the switch where the record says it is rather
       than where the press left it */
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("slides the knob by LOGICAL side, so Persian moves it the right way", () => {
    /*
     * THE ONE THAT WOULD SHIP BROKEN AND LOOK FINE. `translate-x` is physical:
     * a knob told to move right moves right in Persian too, i.e. toward the
     * OFF end of an RTL track, silently. The check is on the class rather than
     * on a rendered pixel because jsdom lays nothing out — but `end-0.5` is
     * the whole mechanism, and its absence is what a physical transform looks
     * like here.
     */
    const { rerender, container } = render(
      <Switch checked={false} onChange={() => undefined} label="x" />,
    );
    const knob = () => container.querySelector("span[aria-hidden]")!;
    expect(knob().className).toContain("start-0.5");
    expect(knob().className).not.toMatch(/translate-x/);

    rerender(<Switch checked onChange={() => undefined} label="x" />);
    expect(knob().className).toContain("end-0.5");
  });

  it("has two named sizes and no third", () => {
    /* the point of the component: the product had a 24×44 track and a 20×36
       one with nothing naming either, so a screen wanting a compact switch
       drew a third. Both are here, and choosing one is now a word. */
    const { container: md } = render(<Switch checked onChange={() => undefined} label="a" />);
    const { container: sm } = render(
      <Switch checked onChange={() => undefined} label="b" size="sm" />,
    );
    expect(md.querySelector('[role="switch"]')!.className).toContain("h-6 w-11");
    expect(sm.querySelector('[role="switch"]')!.className).toContain("h-5 w-9");
    /* and the knob scales WITH the track — a 20px knob in a 20px track is a
       switch with no travel, which is what mixing the two by hand produces */
    expect(md.querySelector("span[aria-hidden]")!.className).toContain("h-5 w-5");
    expect(sm.querySelector("span[aria-hidden]")!.className).toContain("h-4 w-4");
  });

  it("carries the platform's hit target", () => {
    /* three of the nine had none: a 20px-tall control with no `.tap` is a 20px
       target on a phone, below the standing 44px ruling */
    render(<Switch checked={false} onChange={() => undefined} label="x" />);
    expect(screen.getByRole("switch").className).toContain("tap");
  });
});
