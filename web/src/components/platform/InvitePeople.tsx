"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { InviteKind, OrgPersonRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { SkeletonLines } from "@/components/scaffold";
import { IconCheck, IconClose } from "@/components/icons";
import { digits, personName } from "@/lib/format";

/**
 * INVITE COLLEAGUES TO A ROOM OR A MEETING (0189).
 *
 * ONE dialog for both, because they are one act with one wire and one
 * outcome — a second copy is the pair that stops matching the first time
 * either gains a rule, and the rule most likely to arrive here is a sentence
 * about what an invitation actually does.
 *
 * ── WHICH IS SAID ON THE DIALOG ITSELF ────────────────────────────────────
 *
 * An invitation grants NOTHING: 0184 made every room readable org-wide and
 * 0145 did the same for meetings. What it carries is attention and a
 * one-press way in. The line under the title says so, because a dialog called
 * "add people" with a button reading «افزودن» would leave somebody believing
 * forty colleagues are in the room the moment they press it — and the day
 * private rooms arrive, that wrong belief is the one they will be reasoning
 * with.
 *
 * The roster is READ HERE rather than passed in. It costs one request when a
 * modal opens, and the alternative is a prop every caller threads through a
 * component tree for a list only this dialog reads.
 */
export function InvitePeople({ kind, targetId, meId, onClose, onFailed }: {
  kind: InviteKind;
  targetId: string;
  /** the reader, excluded from the list — inviting yourself is a
      notification about a decision you just made */
  meId: string | null;
  onClose: () => void;
  onFailed: () => void;
}) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [people, setPeople] = useState<OrgPersonRecord[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  const others = (people ?? []).filter((p) => p.id !== meId);
  const all = picked.length === others.length && others.length > 0;

  return (
    <Overlay onClose={onClose} label={t("addPeople")} size="sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("addPeople")}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      {sent !== null ? (
        <p role="status" className="mb-3 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {t("invitesSent", { n: digits(sent, locale) })}
        </p>
      ) : null}

      <button
        type="button"
        disabled={others.length === 0}
        onClick={() => setPicked(all ? [] : others.map((p) => p.id))}
        className="btn btn-sm mb-2 border border-border text-fg-muted hover:text-fg disabled:opacity-50"
      >
        {all ? t("selectNone") : t("selectAll")}
      </button>

      <div className="max-h-64 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
        {people === null ? (
          <SkeletonLines lines={3} />
        ) : others.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
        ) : others.map((person) => {
          const on = picked.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked((cur) =>
                cur.includes(person.id) ? cur.filter((id) => id !== person.id) : [...cur, person.id])}
              className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                on ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
              }`}
            >
              <Avatar name={personName(person, locale)} size="xs" />
              <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
              {on ? <IconCheck width={12} height={12} /> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="btn text-fg-muted hover:text-fg">
          {tCommon("cancel")}
        </button>
        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => {
            setBusy(true);
            void api.sendInvites({ kind, target_id: targetId, user_ids: picked })
              .then((r) => {
                setBusy(false);
                /* the picks CLEAR and the count SHOWS: pressing again would
                   otherwise re-send to the same people, which the server
                   makes idempotent but the screen would report as a second
                   batch of invitations that never went anywhere */
                setPicked([]);
                setSent(r.invited);
              })
              .catch(() => { setBusy(false); onFailed(); });
          }}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50"
        >
          {t("sendInvites")}
        </button>
      </div>
    </Overlay>
  );
}
