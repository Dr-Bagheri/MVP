"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { OrgPersonRecord, ProjectRecord, ProjectTone } from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { TONE_DOT } from "./tasks/TaskDialogs";
import {
  FIELD_LABEL, PANEL_INPUT, PANEL_TEXTAREA, FOOTER_CANCEL, FOOTER_PRIMARY,
} from "./tasks/panelStyle";
import { IconCheck, IconClose, IconPlus } from "@/components/icons";
import { personName } from "@/lib/format";

/**
 * THE PROJECT DIALOG — one form for making a project and for editing one
 * (user, 2026-09-05: "edit in projects window is not set to what it has in
 * it"). Until then the create dialog carried five fields — name, a line of
 * description, colour, icon, who is on it — and the edit dialog three of
 * them, drawn again in a different anatomy, so a project's icon and roster
 * could be chosen once and never changed from the same door. Two drawings of
 * one form are the pair that stops matching the first time either gains a
 * field; this is the one drawing.
 *
 * Its anatomy is the new-task dialog's (R8/R5): the 15px bold title with the
 * close box beside it, `FIELD_LABEL` over `PANEL_INPUT`/`PANEL_TEXTAREA`,
 * the footer split between cancel at the start and the primary at the end.
 *
 * The people picker is a LIST OF TOGGLES rather than a search box, and that
 * is a size judgement rather than a preference: these are colleagues in one
 * organisation, so the list is short enough to read. When an org outgrows
 * that, the box arrives — and it arrives with a reason, not because a search
 * field looks more finished.
 *
 * EDIT IS DIFF-BASED, like every other form in this product: typing into a
 * field and putting it back sends nothing, so a no-op edit writes no row and
 * a stale page cannot clobber a colleague's change to a field it never
 * touched. The roster is written one person at a time (each call idempotent)
 * and the record is RE-READ once at the end, so the caller adopts the project
 * as the server holds it rather than as the form believed it.
 */

export const PROJECT_TONES: ProjectTone[] = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
];

/* the eight the reference offers. A closed set for the same reason the tone
   is closed: a free emoji field is a text input somebody pastes a sentence
   into, and the card draws it at 20px. */
const ICON_CHOICES = ["📁", "🚀", "🎯", "🧩", "📈", "🛠️", "💡", "🌱"];

type Props = {
  people: OrgPersonRecord[];
  meId: string | null;
  onClose: () => void;
  /** the record as the server returned it — created, or re-read after an edit */
  onSaved: (project: ProjectRecord) => void;
  onFailed: () => void;
} & ({ mode: "create"; project?: undefined } | { mode: "edit"; project: ProjectRecord });

export function ProjectDialog(props: Props) {
  const { people, meId, onClose, onSaved, onFailed } = props;
  const editing = props.mode === "edit" ? props.project : null;
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [name, setName] = useState(editing?.name ?? "");
  const [summary, setSummary] = useState(editing?.summary ?? "");
  const [tone, setTone] = useState<ProjectTone>(editing?.tone ?? "blue");
  const [icon, setIcon] = useState<string | null>(editing ? editing.icon : "📁");
  const [members, setMembers] = useState<string[]>(editing?.member_ids ?? []);
  const [busy, setBusy] = useState(false);

  const patch = useMemo(() => {
    const body: Partial<{ name: string; summary: string; tone: ProjectTone; icon: string | null }> = {};
    if (!editing) return body;
    if (name.trim() !== editing.name) body.name = name.trim();
    if (summary.trim() !== editing.summary) body.summary = summary.trim();
    if (tone !== editing.tone) body.tone = tone;
    if (icon !== editing.icon) body.icon = icon;
    return body;
  }, [editing, name, summary, tone, icon]);
  const added = editing ? members.filter((id) => !editing.member_ids.includes(id)) : [];
  const removed = editing ? editing.member_ids.filter((id) => !members.includes(id)) : [];
  const dirty = editing
    ? Object.keys(patch).length > 0 || added.length > 0 || removed.length > 0
    : name.trim() !== "";
  const canSubmit = dirty && !busy && name.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    const run = editing
      ? (async () => {
          if (Object.keys(patch).length > 0) await api.updateProject(editing.id, patch);
          for (const id of added) await api.setProjectMember(editing.id, id, true);
          for (const id of removed) await api.setProjectMember(editing.id, id, false);
          return api.project(editing.id);
        })()
      : api.createProject({
          name: name.trim(),
          summary: summary.trim(),
          tone,
          icon,
          member_ids: members,
        });
    void run.then(onSaved).catch(() => { setBusy(false); onFailed(); });
  };

  const title = editing ? t("edit") : t("newProject");

  return (
    <Overlay onClose={onClose} label={title} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-bold text-fg">{title}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3">
        <label className="block">
          <span className={FIELD_LABEL}>{t("fieldName")}</span>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={editing ? undefined : t("namePlaceholder")}
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
            placeholder={editing ? undefined : t("summaryPlaceholder")}
            className={PANEL_TEXTAREA}
          />
        </label>

        <TonePicker value={tone} onChange={setTone} label={t("fieldTone")} />

        <div>
          <span className={FIELD_LABEL}>{t("fieldIcon")}</span>
          <div className="flex flex-wrap gap-1.5">
            {ICON_CHOICES.map((choice) => (
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
              const pinned = !editing && person.id === meId;
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

        {/* the rename's consequence, said before it happens rather than
            discovered on the board — a project's name IS its folder's */}
        {editing && "name" in patch ? (
          <p className="well text-[11px] text-fg-muted">
            {t("renameNote")}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onClose} className={FOOTER_CANCEL}>
          {tCommon("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={!canSubmit} className={FOOTER_PRIMARY}>
          {editing ? (
            tCommon("save")
          ) : (
            <>
              <IconPlus width={14} height={14} />
              {busy ? t("creating") : t("create")}
            </>
          )}
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
  const t = useTranslations("projects");
  return (
    <div>
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={t(`tone_${tone}`)}
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
