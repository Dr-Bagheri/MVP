"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  AgentCard, RoomAgentCard, RoomMessageRecord, RoomRecord, User,
} from "@/api/types";
import { formatTime, personName } from "@/lib/format";
import { splitMentions } from "@/lib/roomMentions";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/icons";
import { SkeletonLines } from "@/components/scaffold";
import { KebabMenu } from "@/components/rowActions";
import { AgentMark } from "./AgentMark";
import { useCrumbTitle } from "./CrumbTitle";
import { useAgentCopy } from "./agentAppearance";

/**
 * A ROOM — one thread, several voices, and the agents visibly taking turns
 * (db/0164; user directive, 2026-09-03: "when they are called they need to
 * feel alive and chat separate from the ai assistant itself, and they can
 * talk to each other, the agents together, and work things out").
 *
 * ── What is on screen, and why each part is there ────────────────────────
 *
 * **Every row names its author and shows its face.** In the assistant there
 * are exactly two voices, so a bubble on the end side and prose on the start
 * side is enough to tell them apart. Here there are up to five, two or more of
 * them machines answering EACH OTHER — the interesting message is one agent
 * replying to another with neither addressed to the person — and a thread that
 * showed only "assistant" would erase the one fact that makes the room worth
 * having. The name is a fact about the DATABASE, not a label this file chose:
 * 0164 pins `author_kind` to the writing ROLE, so echo_app physically cannot
 * badge a line as رؤیا's.
 *
 * **An @handle is a chip with a face in it.** The hand-off is the mechanism
 * the room runs on, and it is a mention in the final line. Rendering it as a
 * chip is what makes "handing the state layer to @ava" read as an action
 * rather than as a typo. Only a handle in this room's roster becomes one
 * (`splitMentions`) — a name is not authority, and a chip for an agent that
 * was never invited would draw a hand-off that reached nobody.
 *
 * **The status line is the aliveness.** `working` names who is thinking
 * BEFORE their turn exists, which is the reference's «Fizz: Working» and the
 * reason a room does not look frozen for the forty seconds between two turns.
 *
 * ── The two endings that are not errors ──────────────────────────────────
 *
 * `turn_failed` is an ANNOTATION and never a row. The platform's standing
 * rule: a tidy "something went wrong" line inside a persisted thread is, a
 * week later, indistinguishable from something the agent said. The server
 * agrees — it writes no row for a failed turn — so a bubble here would be a
 * sentence that exists only on this screen, in a record that outlives it.
 *
 * `bounded` is the ceiling, and it is said in plain words. The exchange
 * stopped ON PURPOSE after MAX_AGENT_TURNS; a room that simply went quiet
 * would be indistinguishable from a room where nobody had more to say, and
 * the person would not know that speaking again continues the work (M21: the
 * forfeit is said out loud). It is deliberately NOT the failure tone.
 *
 * ── The row is the record ────────────────────────────────────────────────
 *
 * Every `message` event is emitted by core AFTER its row has landed, so this
 * screen appends what the database already holds and a reload mid-exchange
 * shows exactly the turns that were on screen. Nothing here is optimistic —
 * including the person's own turn, which arrives as the stream's first frame
 * from the row that was written before the headers went out.
 */
export function RoomThread({ id }: { id: string }) {
  const t = useTranslations("rooms");
  const locale = useLocale();
  const agentCopy = useAgentCopy();

  /** `undefined` = still reading; `null` = no such room (or not ours) */
  const [room, setRoom] = useState<RoomRecord | null | undefined>(undefined);
  const [messages, setMessages] = useState<RoomMessageRecord[]>([]);
  const [me, setMe] = useState<User | null>(null);
  /** the person's agent catalogue — see `nameOf` */
  const [cards, setCards] = useState<AgentCard[]>([]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  /** who is taking a turn right now — the reference's status line */
  const [working, setWorking] = useState<RoomAgentCard | null>(null);
  /** turns that produced nothing, named and never written into the thread */
  const [failures, setFailures] = useState<{ key: string; name: string }[]>([]);
  const [bounded, setBounded] = useState(false);
  const [transportFailed, setTransportFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

  const foot = useRef<HTMLDivElement | null>(null);

  /*
   * `undefined` until there is a room, and never `null`.
   *
   * The crumb's `null` means "loaded, and this thing genuinely has no title",
   * which a room can never be: 0164's column check refuses a blank one, so a
   * room that exists has a name and a room that does not exist has no crumb
   * at all. Passing `null` for the 404 would render the untitled-thing word
   * about a thing that is not there — a leaf claiming a room with no name
   * where there is no room.
   */
  useCrumbTitle(room ? room.title : undefined);

  useEffect(() => {
    let alive = true;
    setRoom(undefined);
    void api.room(id)
      .then((answer) => {
        if (!alive) return;
        setRoom(answer.room);
        setMessages(answer.messages);
      })
      .catch(() => { if (alive) setRoom(null); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
    /*
     * The agent CATALOGUE, for names only.
     *
     * A room message carries the agent's stored `author_name` — one spelling,
     * in the language the migration seeded it with — and rendering that
     * straight is the exact defect `seededCopy.guard.test.ts` exists for: an
     * English reader would meet «رؤیا» and nothing would go red, because the
     * resolver falls back to the stored string on purpose.
     *
     * `useAgentCopy` localizes a SYSTEM agent by handle, and only the
     * catalogue knows which level a handle resolved to — the room wire does
     * not carry one. So the cards are read here and joined by handle, and an
     * agent the catalogue does not know keeps its wire name: visible and
     * untranslated beats invisible and broken. (It also means a person whose
     * OWN agent happens to share a shipped handle keeps their own words,
     * which localising by bare handle would silently overwrite.)
     */
    void api.agents().then(setCards).catch(() => setCards([]));
  }, []);

  /** the roster — who may take a turn, and whose @handle becomes a chip */
  const roster = room?.agents ?? [];

  const nameOf = useCallback((handle: string | null, wire: string | null): string => {
    const card = handle === null ? undefined : cards.find((c) => c.handle === handle);
    if (card) return agentCopy(card).name;
    /* `null` is a real state on this wire (a tombstoned person keeps their
       turns), and it renders as its own word rather than as a blank row */
    return wire ?? t("someone");
  }, [cards, agentCopy, t]);

  /* the newest turn, once it exists. `messages.length` rather than the array:
     a re-render that changed nothing must not yank the view. */
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages.length, working]);

  /*
   * SAVE-THEN-ADOPT, never optimistic (the preferences ruling): the screen
   * takes the row the server ANSWERS with, so a title core normalised is the
   * title on screen, and a refusal leaves the room exactly as it was rather
   * than showing a name the database never took.
   */
  async function rename() {
    const next = draftTitle.trim();
    if (next === "" || room === null || room === undefined) return;
    try {
      setRoom(await api.updateRoom(id, { title: next }));
      setRenaming(false);
    } catch {
      /* the input keeps what was typed — a refusal must not also cost it */
    }
  }

  async function setArchived(archived: boolean) {
    if (room === null || room === undefined) return;
    try {
      setRoom(await api.updateRoom(id, { archived }));
    } catch {
      /* nothing moved; the menu will offer the same action again */
    }
  }

  async function send() {
    const body = input.trim();
    if (body === "" || sending || room === null || room === undefined) return;
    setInput("");
    setSending(true);
    setWorking(null);
    setFailures([]);
    setBounded(false);
    setTransportFailed(false);
    /* `done` is ALWAYS the last event by contract, so a stream that simply
       ends died in transport — the hub learned that the hard way (a proxy
       timeout walked the SUCCESS path in silence for a week) and this
       surface is built with the check rather than without it */
    let sawDone = false;
    try {
      for await (const event of api.sayInRoom(id, body, { locale })) {
        switch (event.type) {
          case "message":
            /* THE ROW IS THE RECORD — appended only once the server has
               written it, so what is on screen survives a reload */
            setMessages((prev) => [...prev, event.message]);
            setWorking(null);
            break;
          case "working":
            setWorking(event.agent);
            break;
          case "turn_failed":
            setWorking(null);
            setFailures((prev) => [
              ...prev,
              { key: `${event.agent.id}-${prev.length}`, name: nameOf(event.agent.handle, event.agent.name) },
            ]);
            break;
          case "bounded":
            setBounded(true);
            break;
          case "done":
            sawDone = true;
            setWorking(null);
            break;
          // no default: the contract is unknown-types-ignorable
        }
      }
      if (!sawDone) setTransportFailed(true);
    } catch {
      setTransportFailed(true);
    } finally {
      setWorking(null);
      setSending(false);
    }
  }

  if (room === undefined) {
    /* the THREAD's shape while its rows are on the way — never the empty
       sentence, which would claim the room has nothing in it */
    return (
      <div aria-busy="true" className="flex h-full min-h-0 flex-col">
        <SkeletonLines lines={6} className="mt-2" />
      </div>
    );
  }
  if (room === null) {
    return <p className="mt-6 text-sm text-fg-muted">{t("gone")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        WHO IS IN THE ROOM. Not decoration: the roster is what decides which
        @handle can hand work to whom, so it is the first thing a person needs
        in order to read the exchange below.

        The room's NAME is deliberately not repeated here — it is the trail's
        leaf crumb in the top bar (`useCrumbTitle` above), and the platform
        stopped drawing page titles inside pages on 2026-09-02. A second copy
        would be the one screen whose title block is a different shape from
        every other, which is the divergence that directive was about.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {roster.map((agent) => (
          <span
            key={agent.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pe-2.5 ps-1"
          >
            <AgentMark icon={agent.icon} color={agent.color} size="xs" />
            <span className="text-xs text-fg-muted">{nameOf(agent.handle, agent.name)}</span>
          </span>
        ))}
        {renaming ? (
          /*
           * RENAME IN PLACE, and not `window.prompt`: the browser dialog is
           * unstyled in both themes, carries no RTL or Persian type, says
           * "app.neurai.pt says", and is forbidden here by
           * nativeDialog.guard.test.ts. This is the inline composer the task
           * board already uses for the same job.
           */
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); void rename(); }}
          >
            <input
              className="input-sm"
              autoFocus
              maxLength={200}
              value={draftTitle}
              aria-label={t("roomTitle")}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setRenaming(false); }}
            />
            <button type="submit" className="btn-sm" disabled={draftTitle.trim() === ""}>
              {t("saveTitle")}
            </button>
            <button type="button" className="btn-sm" onClick={() => setRenaming(false)}>
              {t("cancel")}
            </button>
          </form>
        ) : (
          <span className="ms-auto">
            <KebabMenu
              label={t("roomMenu")}
              items={[
                {
                  key: "rename",
                  label: t("rename"),
                  icon: <Icon name="pencil" size="sm" />,
                  onSelect: () => { setDraftTitle(room.title); setRenaming(true); },
                },
                {
                  key: "archive",
                  label: room.archived ? t("unarchive") : t("archive"),
                  icon: <Icon name="archive" size="sm" />,
                  /* NOT `danger`: archiving is reversible from this same menu,
                     and the red group is for what cannot be taken back */
                  onSelect: () => { void setArchived(!room.archived); },
                },
              ]}
            />
          </span>
        )}
      </div>

      <div className="scroll-quiet fade-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
        {messages.length === 0 && !sending ? (
          <p className="text-sm leading-7 text-fg-muted">{t("threadEmpty")}</p>
        ) : null}

        {messages.map((message) => (
          <Turn
            key={message.id}
            message={message}
            roster={roster}
            authorName={
              message.author_kind === "agent"
                ? nameOf(message.author_handle, message.author_name)
                : personName(
                    {
                      display_name: message.author_name ?? t("someone"),
                      display_name_en: message.author_name_en,
                    },
                    locale,
                  )
            }
            nameOf={nameOf}
            time={formatTime(message.created_at, locale)}
            selfLabel={
              me !== null && message.author_user_id === me.id ? t("you") : null
            }
          />
        ))}

        {/*
          THE FORFEITS, under the exchange they belong to and OUTSIDE the
          thread: no bubble, no avatar, no author. Each is our commentary on
          the record, and the record must never be able to absorb it.
        */}
        {failures.map((failure) => (
          <p key={failure.key} className="text-xs leading-6 text-warning">
            {t("turnFailed", { name: failure.name })}
          </p>
        ))}

        {bounded ? (
          /* NOT the failure tone. The exchange stopped where it was told to
             stop, and the sentence says what to do about it. */
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-6 text-fg-muted">
            {t("bounded")}
          </p>
        ) : null}

        {transportFailed ? (
          <p className="text-xs leading-6 text-warning">{t("transportFailed")}</p>
        ) : null}

        <div ref={foot} />
      </div>

      {/*
        THE STATUS LINE — «رؤیا: در حال کار» — above the composer, exactly
        where the reference puts it. It renders only while a turn is in
        flight, so it is never a permanent strip of chrome.
      */}
      {working !== null ? (
        <p
          aria-live="polite"
          className="mt-2 flex items-center gap-2 text-xs text-fg-muted"
        >
          <AgentMark icon={working.icon} color={working.color} size="xs" />
          {t("working", { name: nameOf(working.handle, working.name) })}
        </p>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => { event.preventDefault(); void send(); }}
      >
        <textarea
          className="input min-h-11 flex-1 resize-none py-2.5"
          rows={1}
          value={input}
          disabled={room.archived}
          placeholder={room.archived ? t("archivedComposer") : t("composerPlaceholder")}
          aria-label={t("composerLabel")}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            /* Enter sends, Shift+Enter breaks the line — the composer idiom
               this platform already uses, so a room does not need learning */
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="btn bg-accent font-semibold text-on-accent"
          disabled={sending || input.trim() === "" || room.archived}
        >
          <Icon name="send" size="sm" />
          <span className="ms-1.5">{t("send")}</span>
        </button>
      </form>
    </div>
  );
}

/**
 * ONE TURN.
 *
 * Avatar-or-mark, name, time, body — the reference's row, and the shape that
 * makes several voices readable. A person is a round well with their initial;
 * an agent is its own glyph in its own tone (`AgentMark` says why the two must
 * not be the same mark).
 */
function Turn({
  message,
  roster,
  authorName,
  nameOf,
  time,
  selfLabel,
}: {
  message: RoomMessageRecord;
  roster: readonly RoomAgentCard[];
  authorName: string;
  nameOf: (handle: string | null, wire: string | null) => string;
  time: string;
  /** «شما» on the reader's own turns — absent on everyone else's */
  selfLabel: string | null;
}) {
  const isAgent = message.author_kind === "agent";
  return (
    <div className="message-arrives flex gap-2.5" data-author-kind={message.author_kind}>
      {isAgent ? (
        <AgentMark icon={message.author_icon ?? "sparkle"} color={message.author_color ?? "violet"} size="sm" />
      ) : (
        <Avatar name={authorName} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          {/* `data-author` so a test can ask WHOSE row this is without
              matching the name anywhere in it — an @mention chip in the body
              carries a colleague's name too, and a check that could not tell
              the two apart would report the wrong author as correct */}
          <span data-author className="text-sm font-semibold text-fg">{authorName}</span>
          {selfLabel ? <span className="text-xs text-fg-subtle">{selfLabel}</span> : null}
          <span className="text-xs text-fg-subtle">{time}</span>
        </p>
        <div className="mt-0.5 whitespace-pre-wrap text-sm leading-7 text-fg">
          <Body text={message.body} roster={roster} nameOf={nameOf} />
        </div>
      </div>
    </div>
  );
}

/** The message text, with roster mentions drawn as chips carrying a face. */
function Body({
  text,
  roster,
  nameOf,
}: {
  text: string;
  roster: readonly RoomAgentCard[];
  nameOf: (handle: string | null, wire: string | null) => string;
}) {
  const parts = splitMentions(text, roster.map((agent) => agent.handle));
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          // eslint-disable-next-line react/no-array-index-key -- runs have no id; the list is derived and never reordered
          <span key={index}>{part.text}</span>
        ) : (
          <Mention
            // eslint-disable-next-line react/no-array-index-key -- same
            key={index}
            agent={roster.find((agent) => agent.handle === part.handle)!}
            nameOf={nameOf}
          />
        ),
      )}
    </>
  );
}

function Mention({
  agent,
  nameOf,
}: {
  agent: RoomAgentCard;
  nameOf: (handle: string | null, wire: string | null) => string;
}) {
  return (
    <span
      className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pe-2 ps-0.5 align-middle text-xs font-medium text-accent"
      data-mention={agent.handle}
    >
      <AgentMark icon={agent.icon} color={agent.color} size="xs" />
      {nameOf(agent.handle, agent.name)}
    </span>
  );
}
