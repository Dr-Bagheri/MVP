"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ReminderItem } from "@/api/types";
import { DateField, TimeField } from "@/components/DateTimeFields";
import { DataTable, type Column } from "@/components/DataTable";
import { Card } from "@/components/ui";
import { FormRow } from "@/components/scaffold";
import { formatDate, formatTime, instantFromFields, nowFields } from "@/lib/format";
import { notify, notifyError } from "@/lib/notify";
import { ConfirmDialog, IconAction } from "@/components/rowActions";
import { IconTrash } from "@/components/icons";

/**
 * SETTINGS · ALARMS (user directive, 2026-09-18: "a page in settings that you
 * can set a time for alarm that gives you a notification pop up in the
 * platform … the alarm page must have date and hour to set, the hour dropdown
 * the hour must be left and min must be right").
 *
 * The hour/minute order was ruled on 2026-09-03 and `TimeField` has drawn it
 * that way ever since: hour on the LEFT in both locales, because the value it
 * edits is `HH:mm` and a clock time is an LTR number even in Persian. This
 * page reuses that control rather than drawing a second one — a picker with
 * its own columns here would be the place the two orders come apart.
 *
 * ── WHAT THIS PAGE DOES NOT LIST ──────────────────────────────────────────
 *
 * Task deadlines and meetings. They alarm too — that is the rest of the
 * directive — but they are not rows here and never will be: they are computed
 * from `task.due_at` and `meeting.scheduled_at` on every poll, so a list of
 * them here would be a copy that goes wrong the moment somebody moves a
 * deadline. What this page holds is what a person TYPED, which exists nowhere
 * else. The sentence under the title says so, because a settings page that
 * silently covers one third of a feature reads as the whole of it.
 *
 * ── THE ZONE ──────────────────────────────────────────────────────────────
 *
 * `nowFields` and `instantFromFields` are the platform's pair, and using them
 * is not a style choice: fields written in Tehran and parsed with
 * `new Date(...)` read as the BROWSER's local time, so an alarm set for 14:30
 * would be stored for 14:30 in whatever zone the laptop happens to be in. The
 * meeting form paid that bill on 2026-09-06 and these two functions are what
 * came out of it.
 */
export function AlarmSettings() {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const [rows, setRows] = useState<ReminderItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState("");
  /* opens on the NEXT round hour rather than on now: an alarm for the moment
     you are setting it is not a thing anybody wants, and a blank field is a
     question the person has to answer twice */
  const [when, setWhen] = useState(() => nowFields(new Date(Date.now() + 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ReminderItem | null>(null);

  const load = useCallback(() => {
    void api
      .reminders()
      .then((r) => { setRows(r.reminders); setFailed(false); })
      /* `null` is STILL ASKING and `[]` is "you have set none" — the same
         split the rest of the platform keeps, so the empty sentence appears
         only after an answer rather than during the wait */
      .catch(() => { setFailed(true); setRows([]); notifyError(t("loadFailed")); });
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const add = () => {
    if (busy) return;
    const words = label.trim();
    if (words === "") return;
    const at = instantFromFields(when.date, when.time);
    if (Number.isNaN(at.getTime())) { notify(t("badTime"), "warn"); return; }
    setBusy(true);
    void api
      .setReminder(at.toISOString(), words)
      .then(() => { setLabel(""); load(); })
      .catch(() => notify(t("saveFailed"), "warn"))
      .finally(() => setBusy(false));
  };

  const remove = (row: ReminderItem) => {
    setBusy(true);
    void api
      .removeReminder(row.id)
      .then(() => load())
      .catch(() => notify(t("removeFailed"), "warn"))
      .finally(() => { setBusy(false); setConfirmRemove(null); });
  };

  const columns: Column<ReminderItem>[] = [
    {
      key: "label",
      header: t("colLabel"),
      className: "font-medium text-fg",
      cell: (row) => row.label,
    },
    {
      key: "at",
      header: t("colWhen"),
      cell: (row) => `${formatDate(row.at, locale)} · ${formatTime(row.at, locale)}`,
    },
    {
      key: "actions",
      header: t("colActions"),
      cell: (row) => (
        <IconAction label={t("remove")} onClick={() => setConfirmRemove(row)}>
          <IconTrash width={14} height={14} />
        </IconAction>
      ),
    },
  ];

  return (
    <>
      <Card>
        <h2 className="h-section">{t("newTitle")}</h2>
        <div className="mt-3 space-y-3">
          <FormRow label={t("labelField")} htmlFor="alarm-label">
            <input
              id="alarm-label"
              className="input w-full"
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("labelPlaceholder")}
            />
          </FormRow>
          <FormRow label={t("whenField")} htmlFor="alarm-date" wide>
            {/* DATE then TIME, in that order and on one line: the date is the
                coarse answer and the time refines it, which is the order a
                person says it in. The time panel's own hour/minute order is
                `TimeField`'s and is ruled there. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-48">
                <DateField id="alarm-date" value={when.date} onChange={(date) => setWhen((w) => ({ ...w, date }))} />
              </div>
              <div className="w-36">
                <TimeField value={when.time} onChange={(time) => setWhen((w) => ({ ...w, time }))} />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || label.trim() === ""}
                onClick={add}
              >
                {t("add")}
              </button>
            </div>
          </FormRow>
        </div>
      </Card>

      <Card className="mt-3">
        <h2 className="h-section">{t("listTitle")}</h2>
        <div className="mt-3">
          <DataTable
            columns={columns}
            rows={rows ?? []}
            rowKey={(row) => row.id}
            loading={rows === null}
            empty={<p className="text-sm text-fg-muted">{failed ? t("loadFailed") : t("none")}</p>}
          />
        </div>
      </Card>

      {confirmRemove !== null ? (
        <ConfirmDialog
          title={t("removeTitle")}
          body={confirmRemove.label}
          confirmLabel={t("remove")}
          cancelLabel={t("cancel")}
          busy={busy}
          onConfirm={() => remove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      ) : null}
    </>
  );
}
