import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/api/types";

/**
 * «How would you like to use NeurAI first?» — once, for the right person,
 * and «try it now» starts a REAL lesson.
 *
 * The door's own rule is pure (`firstRunDue`) so its matrix is asserted
 * without rendering; the rendered half asserts the two acts and the video
 * shipped films without changing the real lesson actions.
 */
const me = vi.fn();
const updateOnboarding = vi.fn();
vi.mock("@/api/client", () => ({
  api: { me: () => me(), updateOnboarding: (...args: unknown[]) => updateOnboarding(...args) },
}));
const startTour = vi.fn();
vi.mock("@/lib/tour", () => ({ startTour: (...args: unknown[]) => startTour(...args) }));

const { FirstRunDoor, firstRunDue } = await import("./FirstRunDoor");

const DONE = {
  id: "u1", onboarding_completed_at: "2026-09-15T00:00:00Z", onboarding: {},
} as unknown as Me;

beforeEach(() => {
  me.mockReset().mockResolvedValue(DONE);
  updateOnboarding.mockReset().mockResolvedValue(DONE);
  startTour.mockReset();
});

describe("firstRunDue — who sees the door", () => {
  it("a member who finished the flow and has not seen the door", () => {
    expect(firstRunDue(DONE)).toBe(true);
  });
  it("NOT somebody mid-flow (they are on /onboarding), nobody, an un-migrated deployment, or a person who has seen it", () => {
    expect(firstRunDue({ ...DONE, onboarding_completed_at: null })).toBe(false);
    expect(firstRunDue(null)).toBe(false);
    expect(firstRunDue(undefined)).toBe(false);
    expect(firstRunDue({ id: "u1" } as unknown as Me)).toBe(false);
    expect(firstRunDue({ ...DONE, onboarding: { firstRunSeen: true } })).toBe(false);
  });
});

describe("the door", () => {
  it("«try it now» starts the chosen lesson at its real control and records the choice", async () => {
    render(<FirstRunDoor />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "کارها را برنامه‌ریزی کن" }));
    fireEvent.click(screen.getByRole("button", { name: "همین حالا امتحان کن" }));
    expect(startTour).toHaveBeenCalledWith([
      expect.objectContaining({ href: "/tasks", target: "board-add" }),
    ]);
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { firstRunSeen: true, firstRunChoice: "tasks" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("«later» records that the door was seen and starts nothing", async () => {
    render(<FirstRunDoor />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "بعداً" }));
    expect(startTour).not.toHaveBeenCalled();
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { firstRunSeen: true } });
  });

  it("renders nothing for a person it is not due for", async () => {
    me.mockResolvedValue({ ...DONE, onboarding: { firstRunSeen: true } });
    const { container } = render(<FirstRunDoor />);
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches the shipped Persian film with the chosen lesson; watching does not write or start a tour", async () => {
    render(<FirstRunDoor />);
    await screen.findByRole("dialog");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/demo/fa/meeting.mp4");
    expect(document.querySelector("video")?.getAttribute("src")).not.toContain("ask");

    fireEvent.click(screen.getByRole("radio", { name: "از دستیار بپرس" }));
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/demo/fa/ask.mp4");
    expect(video?.querySelector("track")?.getAttribute("src")).toBe("/demo/fa/ask.vtt");
    expect(screen.queryByText(/ویدیوی این بخش/)).toBeNull();
    expect(updateOnboarding).not.toHaveBeenCalled();
    expect(startTour).not.toHaveBeenCalled();
  });
});
