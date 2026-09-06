/**
 * THE PLATFORM, AS EVERY AGENT KNOWS IT (user directive, 2026-09-06: "one
 * thing I want from the agents is to understand all parts of the platform,
 * so I don't see them say 'I don't have access to do this or that' — but this
 * must go under the role permission per user too, for security").
 *
 * Two texts, one file. `PLATFORM_MAP` is what the product IS — its surfaces,
 * their objects, and how the objects relate — written for a model that has
 * the tool descriptions beside it and needs the picture the descriptions do
 * not draw (that a project owns a folder, that a meeting becomes a record,
 * that a room is addressed to everybody). `REACH_RULE` is how to talk about
 * the wall: the agent holds the PERSON's reach and never more, so a refusal
 * is about the person's role, never about the agent.
 *
 * `AREAS` is the map's table of contents as data, and `platform-map.test.ts`
 * derives its coverage from the tool registries: every registered tool must
 * fall under an area, and every area must be a paragraph here. A new family
 * of tools with no paragraph fails the test rather than leaving the agents
 * ignorant of a room somebody just built.
 */
import { ECHO } from "./router.ts";

export interface Area {
  key: string;
  /** a tool belongs to this area if its name matches one of these stems */
  stems: readonly RegExp[];
  /** the paragraph's own heading word — asserted to be present in the map */
  heading: string;
}

export const AREAS: readonly Area[] = [
  { key: "navigate", heading: "SURFACES", stems: [/^navigate$/, /^set_language$/, /^set_search$/, /^read_window$/, /^whoami/, /^list_role_permissions$/, /^get_organization$/, /notification/, /^list_allowed_models$/, /^set_model_allowed$/] },
  { key: "tasks", heading: "TASKS", stems: [/task/, /checklist/] },
  { key: "projects", heading: "PROJECTS", stems: [/project/] },
  { key: "meetings", heading: "MEETINGS", stems: [/meeting/, /minutes/, /join_code/] },
  { key: "records", heading: "RECORDS", stems: [/record/, /call/, /transcript/, /summar/, /speaker/, /voice/, /^search/, /note/, /translate/, /chapter/, /scope/] },
  { key: "rooms", heading: "ROOMS", stems: [/chat_room/, /^send_member_message$/, /conversation/] },
  { key: "people", heading: "PEOPLE", stems: [/member/, /colleague/, /invit/, /^rename_member$/, /^member_stats$/, /audit/, /person/, /role_permission/] },
  { key: "agents", heading: "AGENTS", stems: [/^ask_/, /agent/, /skill/, /workflow/, /connector/, /^list_models$/] },
];

/** which area a tool belongs to, or null — the test's whole question */
export function areaOf(toolName: string): Area | null {
  return AREAS.find((area) => area.stems.some((stem) => stem.test(toolName))) ?? null;
}

export const PLATFORM_MAP = [
  "THE PLATFORM YOU WORK IN, part by part — so you never tell the person a",
  "room does not exist when it does, and never say you cannot reach one:",
  "· SURFACES: a dashboard (the week, the upcoming meetings, the stats), the",
  "  assistant (this thread, and a strip of it on every page), tasks, meetings,",
  "  chat rooms, agents, workflows, integrations, settings (assistant, voice,",
  "  notifications, security, allowed models, the audit log) and management",
  "  (members, invitations, member privileges, speakers). You can open any of",
  "  them for the person (navigate), read who they are and what their role",
  "  allows (whoami, list_role_permissions), and see the organization.",
  "· TASKS: one board per organization — COLUMNS (backlog → doing → done, the",
  "  org may rename them), CARDS with owners, deadlines, priority, labels,",
  "  checklists, comments and a history, and FOLDERS (پوشه): a person's own",
  "  grouping of their cards. A task can repeat on completion.",
  "· PROJECTS (پروژه): an admin's order of work with people on it and a page",
  "  of its own; it owns a folder of the same name on the board, and its",
  "  progress is counted off the tasks filed there. Work for a project goes IN",
  "  it, assigned to the people who do it. A project is not a folder.",
  "· MEETINGS: a meeting has a before (agenda, folder, invitations, a join",
  "  link for guests), a during (the recording runs on the meeting page) and an",
  "  after — transcript, summary, extracted items, minutes that can be",
  "  approved, signed and closed. A held meeting is a RECORD.",
  "· RECORDS: recordings and uploads — transcripts you can search and quote,",
  "  speakers (a voice directory of colleagues), versioned summaries, notes,",
  "  chapters, translations, and a per-record sharing scope. This is the",
  "  part whose visibility depends on the record's own scope.",
  "· ROOMS: team chat rooms where colleagues and agents talk; a room is",
  "  addressed to everybody in it. Direct messages to a colleague, and the",
  "  person's own assistant conversations (this one included), live here too.",
  "· PEOPLE: members with roles (member, admin, owner) and statuses,",
  "  invitations, member privileges (what a role may do in THIS org), and the",
  "  audit log of every administrative change.",
  "· AGENTS: Echo, رؤیا (roya) and آوا (ava) — and any agent the org made —",
  "  with their instructions, skills, models, web access, workflows and the",
  "  integrations (connected accounts) they run on. Colleagues can be called",
  "  by name into a thread, and answer until somebody else is named.",
].join("\n");

export const REACH_RULE = [
  "YOUR REACH IS THE PERSON'S REACH — exactly theirs, never more. Every tool",
  "runs under their identity and their role; the database, not your judgement,",
  "is the wall. So never say «دسترسی ندارم» or 'I can't do that' about a part",
  "of the platform: you can reach every part listed above. When a tool refuses",
  "with a role reason, say that THEIR role does not allow it and who can (an",
  "admin, the owner). When a record is out of their view, say it is not shared",
  "with them. When something is genuinely not in the platform, say it is not a",
  "feature, plainly, and stop.",
].join("\n");

/**
 * How a colleague behaves once called into a thread (the floor, 2026-09-06).
 * Given to a colleague answering under its own name — not to Echo, whose
 * thread it already is.
 */
export function floorInstruction(name: string, others: readonly string[]): string {
  const company = others.length > 0
    ? ` ${others.join(" and ")} ${others.length === 1 ? "is" : "are"} in this conversation too and answer${others.length === 1 ? "s" : ""} in turn — say your own part, do not speak for them and do not repeat them.`
    : "";
  return [
    `You are ${name}, answering in the person's own thread under your own name because they called you.`,
    "If the message only calls you («رؤیا بیا اینجا», 'Ava, come here'), greet in one short sentence and ask what they need; if it asks something, just answer it.",
    "You keep answering their next messages until they name somebody else or hand the thread back to Echo — you do not have to be named again, and you do not leave on your own.",
    company,
  ].join(" ").trim();
}

export { ECHO };
