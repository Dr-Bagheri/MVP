"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { OrgPersonRecord, ProjectRecord, ProjectTone } from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { TONE_DOT } from "./tasks/TaskDialogs";
import {
  DIALOG_BODY, FIELD_LABEL, PANEL_INPUT, PANEL_TEXTAREA, FOOTER_CANCEL, FOOTER_PRIMARY,
} from "./tasks/panelStyle";
import { IconCheck, IconClose, IconPlus } from "@/components/icons";
import { personName } from "@/lib/format";

/**
 * THE NEW-PROJECT DIALOG — the form that MAKES one, and since 2026-09-08 only
 * that (user: "in projects edit mode it should edit the existing page the same
 * way in tasks edit, not popping up another window").
 *
 * It carried both acts for three days, on the argument that two drawings of
 * one form stop matching. The argument was right and the conclusion was one
 * step too far: creating and editing are not the same act. Creating needs
 * every field in front of the person at once, because there is no row yet and
 * a half-made project has nowhere to be. Editing changes ONE field against a
 * row that already exists, and belongs where that row is read — which for a
 * project is now `ProjectDetail`'s rail, exactly as a card's is `TaskDetail`'s.
 * The board has had this split since 0144; the project simply did not.
 *
 * So what is left here is the create path, and the edit machinery — the
 * diff-based patch, the roster's added/removed pair, the rename note — moved
 * with the act it belonged to rather than being kept for a caller that no
 * longer exists.
 *
 * Its anatomy is the new-task dialog's (R8/R5): the 15px bold title with the
 * close box beside it, `FIELD_LABEL` over `PANEL_INPUT`/`PANEL_TEXTAREA`, the
 * footer split between cancel at the start and the primary at the end.
 *
 * The people picker is a LIST OF TOGGLES rather than a search box, and that
 * is a size judgement rather than a preference: these are colleagues in one
 * organisation, so the list is short enough to read. When an org outgrows
 * that, the box arrives — and it arrives with a reason, not because a search
 * field looks more finished.
 *
 * THE 0208 FIELDS ARE NOT HERE ON PURPOSE. A project's stage, priority, lead
 * and two dates are all editable in the panel the moment it exists, and a
 * create form that asks nine questions before anything can be made is a form
 * people abandon at the fourth. Every one of them has a column default that
 * reads as an honest starting state: planning has not begun, nobody has been
 * named, no date has been promised.
 */

export const PROJECT_TONES: ProjectTone[] = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
];

/* the eight the reference offers. A closed set for the same reason the tone
   is closed: a free emoji field is a text input somebody pastes a sentence
   into, and the card draws it at 20px. EXPORTED since 2026-09-08: the detail
   panel's rail offers the same eight, and a second list there is the pair
   that drifts. */
export const PROJECT_ICONS = ["📁", "🚀", "🎯", "🧩", "📈", "🛠️", "💡", "🌱"];

export function ProjectDialog({ people, meId, onClose, onSaved }: {
  people: OrgPersonRecord[];
  meId: string | null;
  onClose: () => void;
  /** the record as the server created it */
  onSaved: (project: ProjectRecord) => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [tone, setTone] = useState<ProjectTone>("blue");
  const [icon, setIcon] = useState<string | null>("📁");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /* A REFUSED WRITE KEEPS THE DIALOG (2026-09-06, the check-up). It used to
     call an `onFailed` that every parent answered by CLOSING it — the name,
     the summary, the tone and the roster gone with a toast at the top of a
     page the person was no longer looking at. The refusal is said HERE, over
     the draft it refused, and the draft stays to be sent again. */
  const [refused, setRefused] = useState(false);

  const canSubmit = !busy && name.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setRefused(false);
    void api.createProject({
      name: name.trim(),
      summary: summary.trim(),
      tone,
      icon,
      member_ids: members,
    })
      .then(onSaved)
      .catch(() => { setBusy(false); setRefused(true); });
  };

  const title = t("newProject");

  return (
    <Overlay onClose={onClose} label={title} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-bold text-fg">{title}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className={DIALOG_BODY}>
        <label className="block">
          <span className={FIELD_LABEL}>{t("fieldName")}</span>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("namePlaceholder")}
            className={PANEL_INPUT}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t("fieldSummary")}</span>
          <textarea
            value={summary}
            maxLength={400}
            rows={2}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("summaryPlaceholder")}
            className={PANEL_TEXTAREA}
          />
        </label>

        <TonePicker value={tone} onChange={setTone} label={t("fieldTone")} />

        <div>
          <span className={FIELD_LABEL}>{t("fieldIcon")}</span>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_ICONS.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={icon === choice}
                onClick={() => setIcon((cur) => (cur === choice ? null : choice))}
                /* the same box as the colour swatch beside it — a picker
                   whose two rows are different sizes reads as two features */
                className={`btn btn-icon hover:bg-surface-2 ${
                  icon === choice ? "bg-accent-soft ring-2 ring-accent" : ""
                }`}
              >
                <span className="text-base">{choice}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={FIELD_LABEL}>{t("fieldMembers")}</span>
          <div className="well max-h-44 space-y-1 overflow-y-auto p-1.5">
            {people.length === 0 ? (
              <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
            ) : people.map((person) => {
              /* ON CREATE the creator is already on it and the row says so
                 rather than offering a toggle that changes nothing: the server
                 adds them unconditionally (a project you made and are not on
                 reads as somebody else's), so a switch here would be a control
                 whose off position the server ignores. On EDIT the roster is
                 the record's, and leaving it is a real choice. */
              const pinned = person.id === meId;
              const on = pinned || members.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={pinned}
                  aria-pressed={on}
                  onClick={() => setMembers((cur) =>
                    cur.includes(person.id) ? cur.filter((id) => id !== person.id) : [...cur, person.id])}
                  className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                    on ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
                  } ${pinned ? "cursor-default" : ""}`}
                >
                  <Avatar name={personName(person, locale)} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
                  {person.id === meId ? <span className="text-[10px]">{t("you")}</span> : null}
                  {on ? <IconCheck width={12} height={12} /> : null}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {refused ? <p role="alert" className="mt-3 text-xs text-danger">{t("writeFailed")}</p> : null}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose} className={FOOTER_CANCEL}>
          {tCommon("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={!canSubmit} className={FOOTER_PRIMARY}>
          <IconPlus width={14} height={14} />
          {busy ? t("creating") : t("create")}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * THE COLOUR PICKER — a row of the eight tones the schema allows (0181's
 * closed set; a free colour would be a hex nobody can read from a card).
 *
 * The box is the BOARD'S (its 2026-09-03 note: the 16px colour inside is the
 * picture, `.btn-icon` is the 28px box a person presses — which was `h-7
 * rounded-lg` spelled by hand until the control guard said so). Only the
 * selected ring belongs to this picker. Each swatch is NAMED in the page's
 * language: the rail beside it says the tone in words, and a swatch a screen
 * reader calls "blue" on a Persian page is the one control on it that does
 * not speak Persian.
 */
export function TonePicker({ value, onChange, label }: {
  value: ProjectTone;
  onChange: (tone: ProjectTone) => void;
  label: string;
}) {
  /* the colour names are COMMON words (2026-09-06): the task board's label
     and column pickers say them too, and two namespaces spelling eight
     colours is the pair that drifts. Named `tCommon`, never a second `t`:
     keys.test resolves a file's `t(...)` calls to ONE namespace, and a
     rebound `t` sent every key in this file looking in the wrong one. */
  const tCommon = useTranslations("common");
  return (
    <div>
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={tCommon(`tone_${tone}`)}
            aria-pressed={value === tone}
            onClick={() => onChange(tone)}
            className={`btn btn-icon hover:bg-surface-2 ${value === tone ? "ring-2 ring-accent" : ""}`}
          >
            <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
