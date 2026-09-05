import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R21 — NO EXPLANATIONS UNDER TITLES AND HEADERS (user ruling, 2026-09-05:
 * "remove the guides or explanations from under the titles, headers also. We
 * don't need it. Just the name, and sometimes, if it's too important, one
 * sentence").
 *
 * The sweep that day removed twenty-odd paragraphs: a sentence under every
 * settings card's title, a paragraph under every notification toggle, an
 * intro above the agents grid, a subtitle under two dialog titles, a privacy
 * note above the audit table. They had one FORM, and the form is what this
 * guard watches: a paragraph (or a block span) whose entire content is a
 * translated key named as an explanation — `…Hint`, `…Note`, `…Desc`,
 * `…Subtitle`, `intro`. The sanctioned channel for the one important sentence
 * is a component's own slot (`Field hint=…`, `FormRow description=…`), which
 * this scan does not read: what it forbids is prose written straight into the
 * page under a heading.
 *
 * It is a name-shaped check, and the repo's own rule about those applies: it
 * proves nothing about a paragraph named differently, and it must never fire
 * on something that is not an explanation. So the exceptions are ENTRIES WITH
 * REASONS, and the control test below makes it answer NO to the forms it must
 * not claim.
 */
const SRC = join(process.cwd(), "src");

const EXPLANATION =
  /<(p|span)\b[^>]*>\s*\{t[A-Za-z]*\("([A-Za-z0-9_]*(?:Hint|Note|Desc|Subtitle|Intro|Explain)|intro)"(?:,[^)]*)?\)\}\s*<\/\1>/g;

/**
 * The sentences that stay, each with the reason it is not an explanation
 * under a title. Four kinds survive the ruling, and nothing else does:
 *
 *   STATE       what a screen says INSTEAD of its content — the refusal card
 *               a member sees on an admin page, the pending screen, a record
 *               still processing. That sentence is the page in that state.
 *   ARRIVAL     a stranger's first screen (the guest door, a new org): one
 *               sentence saying what happens next is the difference between
 *               a form and a wall.
 *   CONSEQUENCE what a press will do that the button's name cannot carry —
 *               a rename that reaches the board, a schedule that comes back
 *               when the card is done, a caveat on data that may still change.
 *   CONSTRAINT  a format or a promise beside the control it binds — the
 *               logo's size, what a connected account is and is not read for,
 *               what a key's assistant permission grants.
 */
const ALLOWED: Record<string, string[]> = {
  // STATE — the refusal card a non-admin sees instead of the page
  "components/platform/AuditLogs.tsx": ["adminOnlyNote"],
  "app/[locale]/management/models/page.tsx": ["adminOnlyNote"],
  "app/[locale]/management/server/page.tsx": ["adminOnlyNote"],
  "app/[locale]/management/users/page.tsx": ["adminOnlyNote"],
  // STATE — the pending screen's one sentence is the screen
  "app/[locale]/(auth)/pending/page.tsx": ["pendingHint"],
  // STATE — a record still processing says so once; an empty whiteboard says
  // what it is for while it holds nothing
  "components/platform/meeting/Review.tsx": ["processingNote"],
  "components/platform/meeting/Whiteboard.tsx": ["whiteboardHint"],
  // CONSEQUENCE — the share picker's one trap (an unticked audio box carries
  // no sound), said BEFORE the picker opens, only on an online meeting
  "components/platform/MeetingPage.tsx": ["shareHint"],
  // ARRIVAL — the guest door and a new organisation
  "app/[locale]/join/[code]/page.tsx": ["joinHint"],
  "components/platform/CreateOrg.tsx": ["newOrgHint"],
  // CONSEQUENCE — a transcript that may still change; a rename that reaches
  // the board (shown only once the name has changed); a schedule's meaning
  "app/[locale]/calls/[id]/page.tsx": ["provisionalHint"],
  "components/platform/ProjectDialog.tsx": ["renameNote"],
  "components/platform/tasks/TaskDialogs.tsx": ["scheduleExplain"],
  // CONSEQUENCE — what deleting a member does (emptied, handle retired for
  // good), said beside the field that asks for the reason
  "components/platform/MemberDetail.tsx": ["deleteMemberNote"],
  // CONSTRAINT — the logo's format; what a connection reads; what the key's
  // assistant permission grants; why Drive needs a re-consent
  "components/platform/OrgFields.tsx": ["orgLogoHint"],
  "components/platform/Integrations.tsx": ["privacyNote"],
  "components/platform/IntegrationDetail.tsx": ["privacyNote", "reconnectDriveHint"],
  "app/[locale]/management/connectors/_components/MintKeyDialog.tsx": ["allowAssistantHint"],
  // a keyboard hint beside a composer, and the help page, which IS prose
  "components/platform/tasks/TaskDetail.tsx": ["commentHint"],
  "app/[locale]/help/[[...section]]/page.tsx": ["githubNote"],
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function explanations(code: string): string[] {
  return [...code.matchAll(EXPLANATION)].map((m) => m[2]!);
}

describe("R21: no explanations under titles and headers", () => {
  it("can tell an explanation from the things it must not claim", () => {
    /* the form that shipped and was swept */
    expect(explanations('<p className="mt-1 text-sm text-fg-muted">{t("themeHint")}</p>')).toEqual(["themeHint"]);
    expect(explanations('<span className="block text-xs">{t("agentsWebRowHint")}</span>')).toEqual(["agentsWebRowHint"]);
    expect(explanations('<p className="x">{t("intro")}</p>')).toEqual(["intro"]);
    expect(explanations('<p className="x">{tAdmin("modelAllowNote")}</p>')).toEqual(["modelAllowNote"]);
    /* NOT explanations: a field's own hint slot, an empty state, a value, a
       heading, a key that merely contains the word */
    expect(explanations('<Field label={t("x")} hint={t("fieldHint")}>…</Field>')).toEqual([]);
    expect(explanations('<p className="x">{t("empty")}</p>')).toEqual([]);
    expect(explanations('<p className="x">{t("hintCount", { n })}</p>')).toEqual([]);
    expect(explanations('<h2 className="x">{t("title")}</h2>')).toEqual([]);
    expect(explanations('<p>{t("note")} {name}</p>')).toEqual([]);
  });

  it("no page writes an explanation under a title", () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      const allowed = ALLOWED[rel] ?? [];
      for (const key of explanations(readFileSync(file, "utf8"))) {
        if (!allowed.includes(key)) wrong.push(`${rel}: {t("${key}")}`);
      }
    }
    expect(
      wrong,
      "a title is the name, and at most one sentence when it is too important to leave out — "
        + "move the sentence into the control's own hint slot or delete it:\n" + wrong.join("\n"),
    ).toEqual([]);
  });

  it("the allow-list names real files and keys that still exist", () => {
    for (const [rel, keys] of Object.entries(ALLOWED)) {
      const code = readFileSync(join(SRC, rel), "utf8");
      for (const key of keys) expect(code, `${rel} no longer renders ${key}`).toContain(`("${key}")`);
    }
  });
});
