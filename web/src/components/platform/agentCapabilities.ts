import type { IconName } from "@/components/icons";

/**
 * WHAT AN AGENT CAN DO, GROUPED THE WAY A PERSON WOULD ASK.
 *
 * The detail page listed tool NAMES in code chips with a gear beside each —
 * `search_transcripts`, `list_related_calls` — which is debug output wearing a
 * capability list's clothes. Two things were wrong and only one was visible:
 * the chips showed identifiers, and `agents.tool`, the catalogue
 * `toolDescription()` reads to turn a name into a sentence, was EMPTY. The
 * resolver had been written and the copy never had, so every tool fell through
 * to its own name with the underscores spaced out.
 *
 * ── WHY GROUPS AND NOT A FLAT LIST ────────────────────────────────────────
 *
 * With the per-agent ceiling gone (M48), an agent holds sixty-odd tools. Sixty
 * chips is not a capability list, it is a wall — and the question a reader
 * actually has is "can this one touch my meetings", not "which of the sixty".
 * Five groups answer that at a glance and the sentences answer the follow-up.
 *
 * ── THE ORDER IS THE ANSWER TO "IS THIS SAFE" ─────────────────────────────
 *
 * Reading first, changing last. Somebody scanning this page for the first time
 * is deciding how much to trust a colleague they did not hire, and the honest
 * shape of that answer is: here is everything it can look at, and then, at the
 * bottom, here is what it can change.
 *
 * A tool in no group still renders — under «سایر» — rather than vanishing.
 * A capability that exists and is invisible on the page that lists
 * capabilities is the worse failure, and this file will fall behind the
 * registry the first time somebody adds a tool without opening it.
 */

export interface CapabilityGroup {
  key: string;
  icon: IconName;
  /** tool names, in the order they should read */
  tools: readonly string[];
}

export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    key: "record",
    icon: "fileText",
    tools: [
      "search_transcripts", "read_window", "get_call", "list_related_calls",
      "list_records", "get_summary", "list_summary_versions", "list_speakers",
      "list_record_notes", "list_voices",
    ],
  },
  {
    key: "meetings",
    icon: "calendar",
    tools: [
      "list_meetings", "get_meeting", "list_meeting_items", "list_meeting_folders",
      "create_meeting", "update_meeting", "add_meeting_item", "approve_minutes",
      "archive_meeting", "invite_to_meeting", "open_meeting",
    ],
  },
  {
    key: "tasks",
    icon: "tag",
    tools: [
      "list_tasks", "get_task", "list_task_labels", "create_task", "update_task",
      "complete_task", "assign_task", "comment_on_task",
      "add_task_checklist_item", "archive_task",
    ],
  },
  {
    key: "people",
    icon: "users",
    tools: [
      "list_members", "list_colleagues", "member_stats", "get_organization",
      "list_audit", "send_member_message", "set_member_role", "set_member_status",
      "invite_member", "add_speaker_person",
    ],
  },
  {
    key: "changes",
    icon: "pencil",
    tools: [
      "correct_transcript", "edit_speaker_roster", "replace_summary",
      "rename_record", "set_record_scope", "tag_record", "add_record_note",
      "archive_record", "unarchive_record", "delete_record", "restore_record",
      "delete_conversation", "rename_conversation", "run_workflow",
    ],
  },
  {
    key: "surface",
    icon: "pulse",
    tools: [
      "start_recording", "pause_recording", "resume_recording", "finish_recording",
      "navigate", "open_call", "set_search", "set_language",
    ],
  },
];

/** Every tool this file has placed — used to find the ones it has not. */
const PLACED = new Set(CAPABILITY_GROUPS.flatMap((g) => g.tools));

/**
 * Group a set of tool names, keeping anything unplaced in a final group.
 *
 * Empty groups are dropped: a heading with nothing under it is a claim about
 * an agent that its own list contradicts.
 */
export function groupTools(
  names: readonly string[],
): { key: string; icon: IconName; tools: string[] }[] {
  const held = new Set(names);
  const groups = CAPABILITY_GROUPS
    .map((g) => ({ key: g.key, icon: g.icon, tools: g.tools.filter((t) => held.has(t)) }))
    .filter((g) => g.tools.length > 0);
  const rest = names.filter((n) => !PLACED.has(n));
  return rest.length > 0
    ? [...groups, { key: "other", icon: "chip" as IconName, tools: rest }]
    : groups;
}
