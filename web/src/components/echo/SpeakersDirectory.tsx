"use client";

import { Fragment, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Me, Person } from "@/api/types";
import { Card, EmptyState } from "@/components/ui";
import {
  ENROLLMENT_SCRIPTS,
  MAX_ENROLL_SECONDS,
  MIN_ENROLL_SECONDS,
  type EnrollmentLang,
} from "@/lib/enrollmentScript";

/**
 * The people directory as an Echo section (user directive, 2026-08-17):
 * a table of speakers-as-people with org-chart titles (CEO … employee),
 * addable here, and offered as the dropdown on every call's speaker card.
 *
 * TITLES are codes from db/0062's closed constraint; this file only
 * localizes them. The person's NAME renders as authored — the same verdict
 * as every other name in the product.
 */

export const TITLE_CODES = [
  "ceo", "cto", "coo", "cmo", "cfo",
  "vp", "director", "manager", "lead", "employee", "other",
] as const;

export function SpeakersDirectory() {
  const t = useTranslations("speakersDir");
  const tTitles = useTranslations("titles");
  const locale = useLocale();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  /** role wall (user ruling, 2026-08-22): members ADD and SEE; edit,
      retitle and delete are the admins' and the owner's. The real wall is
      the server's (requireAdmin + db/0076's definer door) — hiding the
      controls here just keeps the screen honest about it. */
  const [me, setMe] = useState<Me | null>(null);
  const canManage = me?.role === "admin" || me?.role === "owner";
  /** inline rename: which row is being edited, and the draft name */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  /** two-click delete, the records-table pattern */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** 0085: the person's deletion carries a reason into the ledger */
  const [confirmReason, setConfirmReason] = useState("");
  /**
   * Voice enrollment (M39; scripted 2026-08-23 by user directive): pressing
   * enroll opens a compact panel with a PLATFORM-PROVIDED passage to read
   * aloud — written for phoneme coverage so the sample carries the full
   * weight of the voice — in Persian or English (both always offered,
   * reading ONE is enough), with Start and Finish & save. Only the VECTOR
   * is stored server-side. The column renders only when the wire carries
   * `voice_enrolled_at` (db/0081 has run) — a control for a column that
   * does not exist would read as wired and do nothing.
   */
  const [enroll, setEnroll] = useState<
    null | {
      personId: string;
      lang: EnrollmentLang;
      phase: "ready" | "recording" | "sending";
      seconds: number;
    }
  >(null);
  const enrollControls = useState<{ finish: (() => void) | null; cancel: (() => void) | null }>(
    { finish: null, cancel: null },
  )[0];
  const voiceReady =
    people !== null && people.length > 0 && people[0] !== undefined
    && "voice_enrolled_at" in people[0];

  function openEnroll(person: Person): void {
    if (enroll) return;
    setEnroll({
      personId: person.id,
      lang: locale === "fa" ? "fa" : "en",
      phase: "ready",
      seconds: 0,
    });
  }

  function closeEnroll(): void {
    enrollControls.cancel?.();
    enrollControls.finish = null;
    enrollControls.cancel = null;
    setEnroll(null);
  }

  async function startEnrollRecording(person: Person): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      notify(t("voiceMicDenied"), "warn");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    /* Cancel must DISCARD: MediaRecorder only hands over data through
       onstop, so the flag is how "finish and save" and "stop and forget"
       share one stop path without the forgotten take being sent anyway. */
    let discard = false;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (discard) return;
      const blob = new Blob(chunks, { type: mime.split(";")[0]! });
      setEnroll((prev) =>
        prev?.personId === person.id ? { ...prev, phase: "sending" } : prev);
      void api
        .enrollVoice(person.id, blob)
        .then(async () => {
          notify(t("voiceEnrolled", { name: person.display_name }));
          setPeople(await api.directory());
        })
        .catch(() => notify(t("voiceFailed"), "warn"))
        .finally(() => setEnroll(null));
    };
    rec.start();
    setEnroll((prev) =>
      prev?.personId === person.id ? { ...prev, phase: "recording", seconds: 0 } : prev);
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1;
      setEnroll((prev) =>
        prev?.personId === person.id ? { ...prev, seconds: elapsed } : prev);
      // walking away with the mic open must not become an unbounded upload
      if (elapsed >= MAX_ENROLL_SECONDS) enrollControls.finish?.();
    }, 1000);
    enrollControls.finish = () => {
      clearInterval(tick);
      enrollControls.finish = null;
      enrollControls.cancel = null;
      if (rec.state !== "inactive") rec.stop();
    };
    enrollControls.cancel = () => {
      clearInterval(tick);
      discard = true;
      enrollControls.finish = null;
      enrollControls.cancel = null;
      if (rec.state !== "inactive") rec.stop();
    };
  }

  async function clearVoiceFor(person: Person): Promise<void> {
    setBusy(true);
    try {
      await api.clearVoice(person.id);
      setPeople(await api.directory());
    } catch {
      notify(t("voiceFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  const speakersEpoch = useRefreshEpoch("speakers");
  useEffect(() => {
    void api.directory().then(setPeople).catch(() => setPeople([]));
  }, [speakersEpoch]);

  useEffect(() => {
    void api.me().then(setMe).catch(() => undefined);
  }, []);

  async function renameFor(person: Person): Promise<void> {
    const next = editName.trim();
    setEditingId(null);
    if (!next || next === person.display_name || busy) return;
    setBusy(true);
    try {
      await api.updatePerson(person.id, { display_name: next });
      notify(t("renamed"));
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFor(person: Person, reason: string): Promise<void> {
    if (busy) return;
    setConfirmId(null);
    setBusy(true);
    try {
      await api.deletePerson(person.id, reason);
      notify(t("personDeleted", { name: person.display_name }));
      setPeople(await api.directory());
    } catch (cause) {
      const { status, detail } = cause as { status?: number; detail?: string };
      const notMigrated = status === 409 || detail === "not_migrated";
      notify(notMigrated ? t("deleteNotReady") : t("deleteFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }


  async function add(): Promise<void> {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await api.createPerson(name.trim(), title);
      setName("");
      setTitle("");
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  async function retitle(person: Person, nextTitle: string): Promise<void> {
    setBusy(true);
    try {
      await api.updatePerson(person.id, { title: nextTitle });
      setPeople(await api.directory());
    } catch {
      notify(t("addFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-[12rem] flex-1"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <select
            className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          >
            <option value="">{t("noTitle")}</option>
            {TITLE_CODES.map((code) => (
              <option key={code} value={code}>
                {tTitles(code)}
              </option>
            ))}
          </select>
          <button
            className="btn-primary h-10 min-h-0 px-4 text-sm"
            disabled={busy || !name.trim()}
            onClick={() => void add()}
          >
            {t("add")}
          </button>
        </div>
        {/* failures announce on the notification system now (orb + bell) */}
      </Card>

      <Card className="!p-0">
        {people === null ? null : people.length === 0 ? (
          <div className="p-4">
            <EmptyState text={t("empty")} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head px-4 py-3 text-start">{t("colName")}</th>
                  <th className="table-head px-4 py-3 text-start">{t("colTitle")}</th>
                  {voiceReady ? (
                    <th className="table-head px-4 py-3 text-start">{t("colVoice")}</th>
                  ) : null}
                  {canManage ? (
                    <th className="table-head px-4 py-3 text-start">{t("colActions")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => (
                  <Fragment key={person.id}>
                  <tr className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium text-fg">
                      {editingId === person.id ? (
                        <input
                          className="input h-9 min-h-0 w-48 py-0 text-sm"
                          value={editName}
                          autoFocus
                          disabled={busy}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void renameFor(person);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => void renameFor(person)}
                        />
                      ) : (
                        person.display_name
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {canManage ? (
                        /* the title is editable IN PLACE — a directory you
                            must leave to correct stops being corrected */
                        <select
                          className="input h-9 min-h-0 w-44 py-0 text-xs"
                          value={person.title}
                          disabled={busy}
                          onChange={(e) => void retitle(person, e.target.value)}
                        >
                          <option value="">{t("noTitle")}</option>
                          {TITLE_CODES.map((code) => (
                            <option key={code} value={code}>
                              {tTitles(code)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        /* members SEE, never edit (user ruling, 2026-08-22) */
                        <span className="text-fg-muted">
                          {person.title ? tTitles(person.title) : t("noTitle")}
                        </span>
                      )}
                    </td>
                    {voiceReady ? (
                      <td className="px-4 py-2.5 text-xs">
                        {enroll?.personId === person.id ? (
                          /* the open panel below carries the ONE set of
                             controls — a twin here is how they disagree */
                          <span className="text-fg-muted" aria-hidden>…</span>
                        ) : person.voice_enrolled_at ? (
                          <span className="flex items-center gap-2">
                            <span className="chip bg-success/15 text-success">{t("voiceOn")}</span>
                            {canManage ? (
                              <button
                                type="button"
                                className="text-fg-muted underline-offset-2 hover:text-danger hover:underline"
                                disabled={busy}
                                onClick={() => void clearVoiceFor(person)}
                              >
                                {t("voiceRemove")}
                              </button>
                            ) : null}
                          </span>
                        ) : canManage ? (
                          <button
                            type="button"
                            className="text-accent underline-offset-2 hover:underline"
                            disabled={busy || enroll !== null}
                            onClick={() => openEnroll(person)}
                          >
                            {t("voiceEnroll")}
                          </button>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                    ) : null}
                    {canManage ? (
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-3 text-xs">
                          <button
                            type="button"
                            className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(person.id);
                              setEditName(person.display_name);
                            }}
                          >
                            {t("edit")}
                          </button>
                          {confirmId === person.id ? (
                            <span className="flex items-center gap-2">
                              <input
                                className="input h-8 min-h-0 w-40 py-0 text-xs"
                                autoFocus
                                placeholder={t("deleteReasonHint")}
                                value={confirmReason}
                                onChange={(e) => setConfirmReason(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Escape") { setConfirmId(null); setConfirmReason(""); } }}
                              />
                              <button
                                type="button"
                                className="text-danger underline-offset-2 hover:underline"
                                disabled={busy || confirmReason.trim().length < 3}
                                onClick={() => {
                                  const reason = confirmReason.trim();
                                  setConfirmId(null);
                                  setConfirmReason("");
                                  void deleteFor(person, reason);
                                }}
                              >
                                {t("confirmDelete")}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                              disabled={busy}
                              onClick={() => { setConfirmId(person.id); setConfirmReason(""); }}
                            >
                              {t("delete")}
                            </button>
                          )}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                  {enroll?.personId === person.id ? (
                    <tr className="bg-surface-2/50">
                      <td
                        colSpan={2 + (voiceReady ? 1 : 0) + (canManage ? 1 : 0)}
                        className="px-4 py-3"
                      >
                        <div className="max-w-xl space-y-2" data-enroll-panel>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium text-fg">
                              {t("voiceScriptTitle")}
                            </span>
                            {/* both languages ALWAYS offered, small — reading
                                one of them is enough to save */}
                            <span
                              className="flex overflow-hidden rounded-lg border border-border"
                              role="group"
                              aria-label={t("voiceScriptTitle")}
                            >
                              {(["fa", "en"] as const).map((l) => (
                                <button
                                  key={l}
                                  type="button"
                                  disabled={enroll.phase !== "ready"}
                                  aria-pressed={enroll.lang === l}
                                  className={`h-7 px-2.5 text-xs transition-colors ${
                                    enroll.lang === l
                                      ? "bg-accent-soft font-semibold text-accent"
                                      : "bg-surface text-fg-muted hover:text-fg"
                                  }`}
                                  onClick={() =>
                                    setEnroll((prev) => (prev ? { ...prev, lang: l } : prev))
                                  }
                                >
                                  {l === "fa" ? "فارسی" : "English"}
                                </button>
                              ))}
                            </span>
                          </div>
                          <p
                            dir={enroll.lang === "fa" ? "rtl" : "ltr"}
                            className="rounded-lg border border-border bg-surface p-3 text-sm leading-7 text-fg"
                          >
                            {ENROLLMENT_SCRIPTS[enroll.lang]}
                          </p>
                          <p className="text-[11px] text-fg-subtle">{t("voiceScriptHint")}</p>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            {enroll.phase === "ready" ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-primary h-8 min-h-0 px-3 text-xs"
                                  onClick={() => void startEnrollRecording(person)}
                                >
                                  {t("voiceStart")}
                                </button>
                                <button
                                  type="button"
                                  className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                                  onClick={closeEnroll}
                                >
                                  {t("voiceCancel")}
                                </button>
                              </>
                            ) : enroll.phase === "recording" ? (
                              <>
                                <span className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger"
                                    aria-hidden
                                  />
                                  <span className="ltr tabular-nums text-fg">
                                    {t("voiceRecording", { s: enroll.seconds })}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="btn-primary h-8 min-h-0 px-3 text-xs"
                                  disabled={enroll.seconds < MIN_ENROLL_SECONDS}
                                  title={
                                    enroll.seconds < MIN_ENROLL_SECONDS
                                      ? t("voiceKeepReading", {
                                          s: MIN_ENROLL_SECONDS - enroll.seconds,
                                        })
                                      : undefined
                                  }
                                  onClick={() => enrollControls.finish?.()}
                                >
                                  {t("voiceFinish")}
                                </button>
                                <button
                                  type="button"
                                  className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                                  onClick={closeEnroll}
                                >
                                  {t("voiceCancel")}
                                </button>
                              </>
                            ) : (
                              <span className="text-fg-muted">{t("voiceSending")}</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
