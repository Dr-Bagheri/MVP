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
