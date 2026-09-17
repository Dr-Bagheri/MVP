import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/api/types";

const updateProfile = vi.fn();
vi.mock("@/api/client", () => ({
  api: { updateProfile: (patch: unknown) => updateProfile(patch) },
}));

const { AvatarEditor } = await import("./AvatarEditor");

const ME = {
  id: "u-1", display_name: "دکتر باقری", display_name_en: null,
  avatar_url: "data:image/png;base64,AAAA", locale: "fa",
} as unknown as Me;

beforeEach(() => {
  updateProfile.mockReset();
  updateProfile.mockImplementation(async (patch: Record<string, unknown>) => ({ ...ME, ...patch }));
});

/**
 * THE PROFILE PHOTO WEARS THE SAME CONTROL AS THE LOGO (user, 2026-09-16:
 * "for profile photo remove the text «حذف عکس» and put the delete icon
 * instead, so they become the same"). The word survives as the trash's
 * name; the camera badge is the change control; removing writes a null
 * avatar and adopts the server's row.
 */
describe("AvatarEditor", () => {
  it("removes through a trash ICON named «حذف عکس», never a text button, and adopts the server's row", async () => {
    const onSaved = vi.fn();
    render(<AvatarEditor me={ME} onSaved={onSaved} />);
    expect(screen.getByRole("button", { name: "تغییر عکس" })).toBeInTheDocument();
    const trash = screen.getByRole("button", { name: "حذف عکس" });
    /* an ICON: the button carries a glyph and no words */
    expect(trash.querySelector("svg")).not.toBeNull();
    expect(trash.textContent).toBe("");
    expect(screen.queryByText("حذف عکس")).toBeNull();

    await userEvent.click(trash);
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ avatar_url: null }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((onSaved.mock.calls[0]![0] as Me).avatar_url).toBeNull();
  });

  it("offers no trash while there is no photo", () => {
    render(<AvatarEditor me={{ ...ME, avatar_url: null }} onSaved={() => undefined} />);
    expect(screen.getByRole("button", { name: "تغییر عکس" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف عکس" })).toBeNull();
  });
});

/**
 * EIGHT READY-MADE AVATARS behind a divider (user, 2026-09-17: "in front of
 * it put a divider and add 8 avatar images, 5 girls and 3 boys, animated,
 * for them to select as a profile image"). jsdom draws nothing, so the
 * canvas and the Image are stubbed to answer as a browser would — the
 * thing under test is the ROAD: a preset goes through the same accept card
 * a picked photo does, and what is uploaded on the accept is what the
 * canvas produced.
 */
describe("the ready-made avatars", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ fillStyle: "", fillRect: () => undefined, drawImage: () => undefined }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => "data:image/jpeg;base64,QUJD");
    class FakeImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      naturalWidth = 256;
      naturalHeight = 256;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
  });

  it("draws the divider and then eight avatars, five women first, each named by its number", () => {
    render(<AvatarEditor me={ME} onSaved={() => undefined} />);
    const group = screen.getByRole("group", { name: "آواتارهای آماده" });
    const presets = Array.from(group.querySelectorAll("button"));
    expect(presets, "eight avatars").toHaveLength(8);
    expect(presets.map((b) => b.getAttribute("aria-label"))).toEqual(
      ["۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸"].map((n) => `آواتار ${n}`),
    );
    /* every one is a picture, not a word */
    for (const b of presets) expect(b.querySelector("svg"), "a preset without its picture").not.toBeNull();
    /* the divider stands BETWEEN the person's own picture and the presets */
    const divider = screen.getByRole("separator");
    expect(divider.nextElementSibling, "the divider is not directly before the avatars").toBe(group);
    expect(divider.previousElementSibling?.contains(screen.getByRole("button", { name: "تغییر عکس" })), "the divider is not directly after the picture control").toBe(true);
  });

  it("a press opens the accept card, and the accept uploads what the canvas drew — the photo's own road", async () => {
    const onSaved = vi.fn();
    render(<AvatarEditor me={{ ...ME, avatar_url: null }} onSaved={onSaved} />);
    expect(screen.queryByText("از این عکس استفاده شود؟")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "آواتار ۳" }));
    /* the accept card, exactly as after a picked file: nothing uploaded yet */
    await screen.findByText("از این عکس استفاده شود؟");
    expect(updateProfile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "استفاده از عکس" }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ avatar_url: "data:image/jpeg;base64,QUJD" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
