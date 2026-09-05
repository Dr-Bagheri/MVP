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
      "resummarize_record", "translate_record", "retry_record",
      "rename_speaker", "link_speaker",
    ],
  },
  {
    key: "meetings",
    icon: "calendar",
    tools: [
      "list_meetings", "get_meeting", "list_meeting_items", "list_meeting_folders",
      "create_meeting", "update_meeting", "add_meeting_item", "approve_minutes",
      "archive_meeting", "invite_to_meeting", "open_meeting",
      "update_meeting_item", "extract_meeting_items", "create_meeting_topic",
      "set_meeting_join_code", "update_meeting_topic",
    ],
  },
  {
    key: "tasks",
    icon: "tag",
    tools: [
      "list_tasks", "get_task", "list_task_labels", "create_task", "update_task",
      "complete_task", "assign_task", "comment_on_task",
      "add_task_checklist_item", "archive_task",
      "list_task_columns", "create_task_column", "create_task_label",
      "set_task_label", "create_task_topic", "update_task_checklist_item",
      "update_task_topic", "update_task_column", "update_task_label",
      "delete_task_label", "delete_task",
    ],
  },
  {
    /* the order board (2026-09-05): a project is created, edited, archived,
       deleted and given to people — the same five verbs the projects page
       offers an admin, at the agent's suggestion and the person's yes */
    key: "projects",
    icon: "folder",
    tools: [
      "create_project", "update_project", "archive_project", "delete_project",
      "set_project_member",
    ],
  },
  {
    key: "people",
    icon: "users",
    tools: [
      "list_members", "list_colleagues", "member_stats", "get_organization",
      "list_audit", "send_member_message", "set_member_role", "set_member_status",
      "invite_member", "add_speaker_person",
      "whoami", "list_invitations", "revoke_invitation", "rename_member",
      "create_person",
    ],
  },
  {
    key: "conversations",
    icon: "ask",
    tools: [
      "list_conversations", "read_conversation", "archive_conversation",
      "share_conversation", "create_chat_room", "update_chat_room",
    ],
  },
  {
    key: "automation",
    icon: "zap",
    tools: [
      "list_workflows", "list_workflow_runs", "set_workflow_enabled",
      "install_workflow_starter", "list_skills", "list_agents",
    ],
  },
  {
    /* the permission matrix lives HERE rather than under people: it is a rule
       about roles, not a fact about a colleague, and the difference is the one
       an agent has to get right before telling somebody they may not do
       something */
    key: "settings",
    icon: "settings",
    tools: [
      "list_role_permissions", "set_role_permission",
      "list_allowed_models", "set_model_allowed",
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
      "whoami_surface", "list_notifications", "mark_notification_read",
      "list_connectors",
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
