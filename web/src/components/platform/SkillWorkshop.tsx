"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { SkillVersion } from "@/api/types";
import { IconRetry, IconSparkle } from "@/components/icons";
import { Skeleton } from "@/components/scaffold";
import { digits, formatDate } from "@/lib/format";

/**
 * Item 16 — what a skill needs before an organisation can rely on one: a
 * history you can read and undo, and a way to try a wording before everybody
 * lives with it.
 *
 * Two panels under the editor, both about the same problem. Saving a prompt
 * makes it the agent's behaviour for the whole organisation from that second,
 * so the two questions an author has are «what did this used to say» and
 * «what will this do» — and until now the product could answer neither.
 */

/* ── the history ─────────────────────────────────────────────────────────── */

export function SkillHistory({ skillId, onRestore }: {
  skillId: string;
  /** hands an old wording back to the EDITOR rather than saving it */
  onRestore: (version: SkillVersion) => void;
}) {
  const t = useTranslations("skills");
  const locale = useLocale();
  const [versions, setVersions] = useState<SkillVersion[] | "unreadable" | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVersions(await api.skillVersions(skillId));
    } catch {
      /* three states: a failed read is not "no history", which is a claim
         about the skill rather than about our request */
      setVersions("unreadable");
    }
  }, [skillId]);

  useEffect(() => { void load(); }, [load]);

  if (versions === null) return <Skeleton className="h-20 w-full" />;
  if (versions === "unreadable") {
    return <p className="text-[12.5px] text-fg-muted">{t("historyUnreadable")}</p>;
  }
  if (versions.length === 0) {
    return <p className="text-[12.5px] text-fg-muted">{t("historyEmpty")}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {versions.map((v, index) => (
        <li key={v.id} className="py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[12.5px] font-semibold text-fg">
              {t("versionN", { n: digits(v.version, locale) })}
            </span>
            {/* the CURRENT one is named, because a list of wordings with no
                mark for which is live is the one thing it must not be */}
            {index === 0 ? (
              <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
                {t("versionCurrent")}
              </span>
            ) : null}
            <span className="text-[11px] text-fg-subtle">{formatDate(v.created_at, locale)}</span>
            <span className="text-[11px] text-fg-subtle">
              {/* null = a migration wrote it: a shipped skill's first wording.
                  Naming a person there would put somebody on a row they never
                  touched. */}
              {v.created_by_name ?? t("versionByPlatform")}
            </span>
            <span className="ms-auto flex gap-1.5">
              <button type="button" className="btn btn-sm btn-secondary"
                onClick={() => setOpen(open === v.id ? null : v.id)}>
                {open === v.id ? t("versionHide") : t("versionShow")}
              </button>
              {index === 0 ? null : (
                <button type="button" className="btn btn-sm btn-secondary"
                  onClick={() => onRestore(v)}>
                  <IconRetry width={12} height={12} />
                  {t("versionRestore")}
                </button>
              )}
            </span>
          </div>
          {open === v.id ? (
            <pre className="well mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-[1.9] text-fg">
              {v.prompt}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ── the dry run ─────────────────────────────────────────────────────────── */

export function SkillDryRun({ prompt, model }: { prompt: string; model: string }) {
  const t = useTranslations("skills");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = prompt.trim() !== "" && question.trim() !== "" && !busy;

  async function tryIt() {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    setAnswer(null);
    try {
      const result = await api.dryRunSkill({
        prompt, question, ...(model === "" ? {} : { model }),
      });
      setAnswer(result.text);
    } catch (error) {
      /* a refusal is SHOWN, with the server's own sentence: «no model is
         available» and «the model call failed» ask for different things back,
         and one word for both is the shape that teaches people to retry */
      setFailed(error instanceof BffError ? error.message : t("dryRunFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* a CONSTRAINT, R21's kept kind: it says what this can and cannot do
          before it is pressed, and there is nowhere else to learn it */}
      <p className="text-[12.5px] leading-[1.9] text-fg-muted">{t("dryRunNote")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          value={question}
          placeholder={t("dryRunPlaceholder")}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void tryIt(); }}
        />
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void tryIt()}>
          <IconSparkle width={14} height={14} />
          {busy ? t("dryRunBusy") : t("dryRun")}
        </button>
      </div>
      {failed !== null ? (
        <p className="text-[12.5px] leading-[1.9] text-danger">{failed}</p>
      ) : null}
      {answer !== null ? (
        <pre className="well whitespace-pre-wrap break-words text-[12.5px] leading-[1.9] text-fg">
          {answer}
        </pre>
      ) : null}
    </div>
  );
}
