import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PictureControl } from "./PictureControl";

/**
 * ONE CONTROL FOR THE PHOTO AND THE LOGO (2026-09-16). The picture is the
 * caller's; what this component owes is the badge that opens the picker,
 * the hand-over of the chosen file with the input CLEARED (so the same file
 * twice still fires), the trash that asks rather than acts, and the absence
 * of both words as text — the user's directive was "put the delete icon
 * instead" of «حذف عکس», so the word may live only as the button's name.
 */
describe("PictureControl", () => {
  it("the badge opens the picker, a pick hands the file over and clears the input, the trash asks to remove", async () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();
    render(
      <PictureControl
        picture={<span>pic</span>}
        hasPicture
        inputId="the-input"
        accept="image/png"
        changeLabel="تغییر"
        removeLabel="حذف"
        onPick={onPick}
        onRemove={onRemove}
      />,
    );
    const input = document.getElementById("the-input") as HTMLInputElement;
    expect(input.type).toBe("file");
    const click = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "تغییر" }));
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(["x"], "a.png", { type: "image/png" });
    await userEvent.upload(input, file);
    expect(onPick).toHaveBeenCalledWith(file);
    /* cleared BEFORE the hand-over: a second pick of the same file is a
       change event only while the input forgot the first */
    expect(input.value).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    /* the words are the buttons' NAMES, never text beside the picture */
    expect(screen.queryByText("حذف")).toBeNull();
    expect(screen.queryByText("تغییر")).toBeNull();
  });

  it("draws no trash while there is nothing to remove — and still the badge", () => {
    render(
      <PictureControl
        picture={<span>pic</span>}
        hasPicture={false}
        accept="image/png"
        changeLabel="تغییر"
        removeLabel="حذف"
        onPick={() => undefined}
        onRemove={() => undefined}
      />,
    );
    /* the DISCRIMINATING half: the badge is there, so "no trash" is a
       decision and not a control that failed to render */
    expect(screen.getByRole("button", { name: "تغییر" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
  });
});
