import { describe, expect, it } from "vitest";
import { canEditProject, isMyProject } from "./projectReach";

/* the web's mirror of db/0227's wall, and the toggle's word — pure, so the
   matrix is asserted without a render */
const mine = { created_by: "me", lead_id: null, member_ids: [] as string[] };
const theirs = { created_by: "sina", lead_id: null, member_ids: [] as string[] };

describe("canEditProject — the controls drawn for a reader", () => {
  it("an admin edits what they made and not what another admin made", () => {
    const admin = { meId: "me", isAdmin: true, isOwner: false };
    expect(canEditProject(mine, admin)).toBe(true);
    expect(canEditProject(theirs, admin)).toBe(false);
  });
  it("the owner edits every project (outranks every author)", () => {
    const owner = { meId: "boss", isAdmin: true, isOwner: true };
    expect(canEditProject(theirs, owner)).toBe(true);
    expect(canEditProject(mine, owner)).toBe(true);
  });
  it("a member edits nothing — not even one they are on or made — and nobody-yet edits nothing", () => {
    expect(canEditProject(mine, { meId: "me", isAdmin: false, isOwner: false })).toBe(false);
    expect(canEditProject(mine, { meId: null, isAdmin: true, isOwner: true })).toBe(false);
  });
});

describe("isMyProject — what «پروژه‌های من» shows", () => {
  it("what I am on, what I lead, or what I made — and not the rest", () => {
    expect(isMyProject({ created_by: "sina", lead_id: null, member_ids: ["me"] }, "me")).toBe(true);
    expect(isMyProject({ created_by: "sina", lead_id: "me", member_ids: [] }, "me")).toBe(true);
    expect(isMyProject({ created_by: "me", lead_id: null, member_ids: [] }, "me")).toBe(true);
    expect(isMyProject(theirs, "me")).toBe(false);
  });
  it("nobody-yet has no projects (loading is not «none of mine», and must not be «all»)", () => {
    expect(isMyProject(mine, null)).toBe(false);
  });
});
