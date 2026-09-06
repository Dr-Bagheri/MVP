import { afterEach, describe, expect, it } from "vitest";
import {
  consentGrantedForSession, grantConsentForSession, resetConsentGrantForTest, sessionGrantCovers, sessionGrantEligible,
} from "./consentGrant";

/**
 * WHAT A STANDING YES MAY COVER (user ruling, 2026-09-06 afternoon: "yes,
 * exclude them"). The list is the product rule, so the test names the classes
 * one by one rather than asserting the regexes — a class that silently left
 * the list would make this file red by name. Both halves are asserted: the
 * excluded verbs AND the covered ones, because a predicate that answers
 * "never" for everything satisfies every exclusion and disables the feature.
 */
describe("sessionGrantEligible — the classes a session-wide yes never covers", () => {
  it.each([
    ["delete_task", "a delete"],
    ["delete_project", "a delete"],
    ["send_member_message", "a message somebody else reads"],
    ["invite_member", "an invitation that lands in a mailbox"],
    ["revoke_api_key", "a grant taken back"],
    ["set_role_permission", "a permission"],
    ["set_member_status", "a member's status"],
    ["set_member_role", "a member's role"],
    ["set_record_scope", "a record's scope"],
    ["approve_minutes", "minutes approved on the org's behalf"],
    ["share_conversation", "a conversation shared"],
    ["set_model_allowed", "the model list"],
  ])("%s is never covered (%s)", (tool) => {
    expect(sessionGrantEligible(tool)).toBe(false);
  });

  it.each(["create_task", "update_task", "archive_task", "create_project", "update_project", "set_project_member",
    "rename_speaker", "create_meeting", "update_meeting", "create_room", "rename_task_column"])(
    "the control: %s is covered — an ordinary create or edit the board can show and a person can undo", (tool) => {
      expect(sessionGrantEligible(tool)).toBe(true);
    });

  it("a prefix does not leak: a tool that merely CONTAINS a barred word is judged by its own name", () => {
    expect(sessionGrantEligible("undelete_task"), "not a delete_ tool").toBe(true);
    expect(sessionGrantEligible("set_member_status_note"), "an exact name, not a family").toBe(true);
  });
});

describe("sessionGrantCovers — on AND eligible", () => {
  afterEach(() => resetConsentGrantForTest());

  it("covers nothing while the yes is off, whatever the tool", () => {
    expect(consentGrantedForSession()).toBe(false);
    expect(sessionGrantCovers("create_task")).toBe(false);
  });

  it("once granted, covers the eligible and never the excluded", () => {
    grantConsentForSession();
    expect(sessionGrantCovers("create_task")).toBe(true);
    expect(sessionGrantCovers("delete_task")).toBe(false);
    expect(sessionGrantCovers("send_member_message")).toBe(false);
    expect(sessionGrantCovers("set_member_role")).toBe(false);
  });
});
