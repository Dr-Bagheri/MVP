"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { AgentCard, RoomRecord } from "@/api/types";
import { formatRelativeDate } from "@/lib/format";
import { PageContainer, PageHeader, SkeletonCards } from "@/components/scaffold";
import { EmptyState, Field } from "@/components/ui";
import { Overlay } from "./Overlay";
import { PlatformShell } from "./PlatformShell";
import { AgentMark } from "./AgentMark";
import { useAgentCopy } from "./agentAppearance";

/**
 * THE ROOMS — the agents surface (db/0164; user directive, 2026-09-03:
 * "remove all we have for agents before … when they are called they need to
 * feel alive and chat separate from the ai assistant itself, and they can talk
 * to each other, the agents together, and work things out").
 *
 * ── What this replaced, and why the replacement is not a browse screen ────
 *
 * What stood here was a catalogue: cards to read, a ⋯ menu to edit an agent's
 * persona, and a panel of workflows to arrange onto it. It was a screen about
 * CONFIGURING agents, and the directive is about TALKING to them. Nobody opens
 * a colleague's settings page to ask them something.
 *
 * So the landing is the person's rooms, newest activity first, and one door to
 * open another. Everything else a room needs — who is in it, what was said,
 * who is thinking — belongs on the room's own screen.
 *
 * ── The picker is two agents, not a wall of options ──────────────────────
 *
 * db/0163 left exactly two system agents: رؤیا, who acts, and آوا, who reads.
 * Each is a row with its face, its name and its one line — enough to choose
 * between them, which is the whole job. The ceiling is the producer's
 * (`ROOM_MAX_AGENTS`), and it is enforced by the server; this screen states it
 * rather than silently ignoring a fifth tick, because a control that accepts a
 * choice the server will refuse is a refusal the person cannot see coming.
 */
/** core's ROOM_MAX_AGENTS. Stated here so the count reads as a decision and
    not as a magic number; the SERVER is what enforces it, and a room opened
    with more is refused there by name (`room_agents_too_many`). */
const MAX_AGENTS = 4;

export function Rooms() {
  const t = useTranslations("rooms");
  const locale = useLocale();
  const router = useRouter();
  const agentCopy = useAgentCopy();

  /** `null` = still reading. An empty array is a real, different answer. */
  const [rooms, setRooms] = useState<RoomRecord[] | null>(null);
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const [opening, setOpening] = useState(false);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  /*
   * A FILTER, not a flag on every row (the conversations list's own reason):
   * the screen shows one set or the other and never both interleaved. It also
   * makes an archived room REACHABLE — a room filed away with no view to find
   * it in would be a one-way door, and this repo names those.
   */
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    /* the LIST resets to null first: switching views must show the frame
       again, not the other view's rows under the new heading */
    setRooms(null);
    void api.rooms({ archived }).then(setRooms).catch(() => setRooms([]));
  }, [archived]);
  useEffect(() => {
    void api.agents().then(setAgents).catch(() => setAgents([]));
  }, []);

  function toggle(handle: string) {
    setPicked((prev) =>
      prev.includes(handle)
        ? prev.filter((entry) => entry !== handle)
        : prev.length >= MAX_AGENTS ? prev : [...prev, handle]);
  }

  async function open() {
    if (title.trim() === "" || picked.length === 0 || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const room = await api.openRoom({ title: title.trim(), agents: picked });
      /* straight into the room: opening one is the first half of saying
         something in it, and a list that merely gained a row would make the
         person find their own new room */
      router.push(`/agents/${room.id}`);
    } catch {
      /* the ticks and the title stay exactly as they were — a refusal must
         not also cost the person what they typed */
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <PlatformShell>
      <PageContainer>
        <PageHeader
          actions={
            <>
              <button
                type="button"
                className="btn-sm"
                aria-pressed={archived}
                onClick={() => setArchived((on) => !on)}
              >
                {archived ? t("showLive") : t("showArchived")}
              </button>
              <button
                type="button"
                className="btn bg-accent font-semibold text-on-accent"
                onClick={() => { setOpening(true); setFailed(false); }}
              >
                {t("newRoom")}
              </button>
            </>
          }
        />

        {rooms === null ? (
          <SkeletonCards count={3} className="grid gap-3" height="h-20" />
        ) : rooms.length === 0 ? (
          /* two different empties, said differently: "you have opened none"
             offers the verb, "nothing is filed away" offers nothing to do —
             an Open-a-room button under the archive would open a LIVE room,
             which is not what the person is looking at */
          archived ? (
            <EmptyState text={t("emptyArchived")} />
          ) : (
            <EmptyState
              text={t("empty")}
              action={
                <button
                  type="button"
                  className="btn bg-accent font-semibold text-on-accent"
                  onClick={() => setOpening(true)}
                >
                  {t("newRoom")}
                </button>
              }
            />
          )
        ) : (
          <ul className="grid gap-3">
            {rooms.map((room) => (
              <li key={room.id}>
                <Link
                  href={`/agents/${room.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{room.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {room.agents.map((agent) => (
                        <span key={agent.id} className="inline-flex items-center gap-1 text-xs text-fg-muted">
                          <AgentMark icon={agent.icon} color={agent.color} size="xs" />
                          {agentName(agents, agentCopy, agent.handle, agent.name)}
                        </span>
                      ))}
                    </span>
                  </span>
                  {/*
                    WHEN, and `last_message_at` is nullable for a reason the
                    wire states: null means nothing has been said in the room
                    yet, which is a real state and not a missing date. It reads
                    as its own word rather than as the room's creation time,
                    which would be a plausible number standing where a fact
                    should be.
                  */}
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {room.last_message_at === null
                      ? t("neverSpoken")
                      : formatRelativeDate(room.last_message_at, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {opening ? (
          <Overlay onClose={() => setOpening(false)} label={t("newRoom")}>
            <h2 className="h-section mb-3">{t("newRoom")}</h2>
            <div className="space-y-4">
              <Field label={t("roomTitle")} hint={t("roomTitleHint")}>
                <input
                  className="input w-full"
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>

              <div>
                <p className="mb-1.5 text-sm font-medium text-fg">{t("whoIsIn")}</p>
                {agents === null ? (
                  <SkeletonCards count={2} className="grid gap-2" height="h-14" />
                ) : agents.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("noAgents")}</p>
                ) : (
                  <ul className="grid gap-2">
                    {agents.map((agent) => {
                      const copy = agentCopy(agent);
                      const on = picked.includes(agent.handle);
                      return (
                        <li key={agent.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors ${
                              on ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong"
                            }`}
                            onClick={() => toggle(agent.handle)}
                          >
                            <AgentMark icon={agent.icon} color={agent.color} size="md" />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-fg">{copy.name}</span>
                              <span className="mt-0.5 block text-xs leading-6 text-fg-muted">{copy.description}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 text-xs text-fg-muted">{t("pickHint", { max: MAX_AGENTS })}</p>
              </div>

              {failed ? <p className="text-xs text-warning">{t("openFailed")}</p> : null}

              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setOpening(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="btn bg-accent font-semibold text-on-accent"
                  disabled={saving || title.trim() === "" || picked.length === 0}
                  onClick={() => void open()}
                >
                  {saving ? t("opening") : t("open")}
                </button>
              </div>
            </div>
          </Overlay>
        ) : null}
      </PageContainer>
    </PlatformShell>
  );
}

/**
 * A roster entry's name, localized through the CATALOGUE when the handle is
 * one the catalogue knows.
 *
 * The same join `RoomThread` makes, and for the same reason: a room's wire
 * carries the agent's stored name — one language, whichever the migration
 * seeded — and rendering it raw is what `seededCopy.guard.test.ts` exists to
 * catch. `null` cards (the read failed, or has not landed) fall back to the
 * wire: visible and untranslated beats invisible.
 */
function agentName(
  cards: AgentCard[] | null,
  copy: (agent: { level: string; handle: string; name: string; description: string }) => { name: string },
  handle: string,
  wire: string,
): string {
  const card = cards?.find((entry) => entry.handle === handle);
  return card ? copy(card).name : wire;
}
