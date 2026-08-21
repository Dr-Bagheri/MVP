"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Person } from "@/api/types";
import { Card, EmptyState } from "@/components/ui";

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
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const speakersEpoch = useRefreshEpoch("speakers");
  useEffect(() => {
    void api.directory().then(setPeople).catch(() => setPeople([]));
  }, [speakersEpoch]);


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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => (
                  <tr key={person.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium text-fg">{person.display_name}</td>
                    <td className="px-4 py-2.5">
                      {/* the title is editable IN PLACE — a directory you
                          must leave to correct stops being corrected */}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
