"use client";

import {
  useEffect, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import {
  IconAgent, IconClose, IconDownload, IconMenu, IconPlug, IconPlus, IconShare, IconTrash, IconZap,
} from "@/components/icons";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { SkeletonLines } from "@/components/scaffold/Skeleton";
import { SIDE_MENU_COLUMN, sideMenuRowClass } from "@/components/scaffold/sideMenu";
import { digits, formatDate, formatTimeAgo } from "@/lib/format";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { untitledNumbers } from "@/lib/sessionTitles";
import {
  assistantServerSnapshot, assistantSnapshot, subscribeAssistant,
} from "@/lib/assistantSession";
import { announceChange } from "@/lib/refreshBus";
import { notify } from "@/lib/notify";
import { useAssistantConversation } from "@/components/platform/AssistantConversationState";
import {
  getPageMenuAnchorSnapshot,
  getServerPageMenuAnchorSnapshot,
  subscribePageMenuAnchor,
} from "@/components/platform/pageMenuAnchor";

/**
 * THE HOME PAGE'S OWN SIDEBAR — three buttons, then the conversations (user
 * directive, 2026-09-08: "I don't like the categories titles, I don't want the
 * agent and the workflows listed, I want a button that when clicked opens in
 * the view pane the page of the workflows and the agents, like here").
 *
 * **A DOOR, NOT A LIST.** The first cut listed five workflows and five agents
 * under headings, which is a shelf: it answers "what exists" and asks the
 * reader to scan it every time they open the platform, while the surfaces that
 * own those lists — with their tabs, their search and their create buttons —
 * do the same job better. Three buttons say it in three rows and never grow.
 *
 * **The buttons open the VIEW PANE; they do not navigate away.** `?view=` is
 * what the page beside this column reads, so the sidebar stays put — which is
 * the point of the reference: somebody who opens Workflows to check one thing
 * is still looking at their conversations. It is a URL rather than state here
 * so the pane survives a reload, is shareable, and has exactly one owner;
 * `/workflows` and `/agents` redirect into it, so there is still one home per
 * surface rather than two screens showing the same list.
 *
 * **NO GROUP TITLES.** «گردش کار» over two rows of workflows was a heading
 * doing the job the rows already did. The conversations need none either — the
 * list under the three buttons is the only list here, and a heading above the
 * only list in a column is a label for the column.
 */

/** the conversations worth showing beside a live composer */
const SESSION_ROWS = 12;

export function HomeSidebar({ sheet = false, onLeave }: {
  /**
   * Rendered inside the phone's slide-over rather than as the page's own
   * column (2026-09-08). Only the column's CHROME differs — the width it is
   * given, the seam it draws against the thread, and the `lg:` gate that
   * hides it. Everything below is the same component, because a second
   * conversations list written for small screens is a second list to keep in
   * step with this one, and the first thing to drift would be which
   * conversation is open.
   */
  sheet?: boolean;
  /** the sheet closes itself when a row inside it navigates — see the sheet */
  onLeave?: () => void;
} = {}) {
  const t = useTranslations("home");
  const tPlatform = useTranslations("platform");
  /* an untitled conversation is named the way the HISTORY TABLE names it —
     numbered over the same list — so «گفت‌وگوی جدید ۲» is the same row in
     both places rather than two conversations that happen to share a word */
  const tConversations = useTranslations("conversations");
  const tCommon = useTranslations("common");
  const tTable = useTranslations("table");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { started, startNewConversation } = useAssistantConversation();

  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  /* WHAT THE LAST ANSWER SAID, not a count the server never sent: a FULL page
     means it may be holding older rows, a short one means it is not. Without
     this the button would either always show (offering nothing) or never
     (hiding everything past twelve) — the history table's own rule. */
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  /** the row awaiting the platform's are-you-sure (see the dialog below) */
  const [condemned, setCondemned] = useState<AssistantSession | null>(null);

  /*
   * SHARE AND EXPORT LIVE ON THE ROW NOW.
   *
   * They were two buttons in a toolbar above the OPEN thread, which made them
   * answerable about one conversation only - the one already on screen - and
   * spent a permanent row on two controls nobody presses twice. They are
   * per-conversation actions, and the kebab beside a conversation is where
   * this product already keeps those: the same menu, the same words, and the
   * same red-last ordering as every other row in the platform.
   *
   * The share STATE has to be read before the menu can be honest about which
   * way the toggle goes, and twelve reads on mount to label a menu nobody has
   * opened is twelve requests for nothing. So it is read when the row's
   * controls APPEAR - hover or focus, the first moment the kebab is reachable
   * - and cached by id, with `asked` holding the in-flight and settled ids so
   * passing over a row twice is still one request.
   */
  const [shareOf, setShareOf] = useState<Record<string, boolean>>({});
  const asked = useRef<Set<string>>(new Set());

  const loadShare = async (id: string) => {
    if (asked.current.has(id)) return;
    asked.current.add(id);
    try {
      const on = await api.shareState(id);
      setShareOf((cur) => ({ ...cur, [id]: on }));
    } catch {
      /* forgotten, so the next hover asks again - a row stuck reading "share"
         because one request failed is a menu that lies */
      asked.current.delete(id);
    }
  };

  const toggleShare = async (id: string) => {
    try {
      const now = await api.setShared(id, !(shareOf[id] ?? false));
      setShareOf((cur) => ({ ...cur, [id]: now }));
    } catch {
      notify(tCommon("actionFailed"), "warn");
    }
  };

  /**
   * THE THREAD AS MARKDOWN - the same file the toolbar used to hand over,
   * fetched here because the sidebar holds no messages: a row's export has to
   * work for a conversation that is not the open one, which is most of them.
   */
  const exportMarkdown = async (id: string, label: string) => {
    try {
      const { messages } = await api.agentThread(id);
      const lines = messages
        .filter((m) => m.content)
        .map((m) => (m.role === "user" ? `**${tPlatform("exportYou")}:** ${m.content}` : m.content));
      const blob = new Blob([lines.join("\n\n---\n\n") + "\n"], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      /* the row's own name, with the characters a file system refuses taken
         out - an untitled conversation keeps its number, so the file on disk
         and the line it came from agree about which thread this is */
      a.download = `${label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "conversation"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify(tCommon("actionFailed"), "warn");
    }
  };

  /*
   * WHICH ROW IS WORKING.
   *
   * Read from the assistant's OWN store rather than from anything this column
   * holds: the thread lives outside React (`lib/assistantSession`) precisely
   * so a run survives navigating away from the composer, which means the
   * conversation being answered can be one the reader is not looking at. That
   * is the row worth colouring — "this one is working" about the open thread
   * is a fact the thread itself is already showing.
   */
  const live = useSyncExternalStore(subscribeAssistant, assistantSnapshot, assistantServerSnapshot);

  /* the same subscription the history table takes: a conversation archived
     from anywhere, or a new one that has just been persisted, lands here
     without a reload */
  const sessionsEpoch = useRefreshEpoch("sessions");

  useEffect(() => {
    let alive = true;
    void api.agentSessions(false, { limit: SESSION_ROWS })
      .then((rows) => {
        if (!alive) return;
        setSessions(rows);
        setHasMore(rows.length >= SESSION_ROWS);
      })
      .catch(() => { if (alive) setSessions([]); });
    return () => { alive = false; };
  }, [sessionsEpoch]);

  /**
   * SHOW MORE, IN PLACE.
   *
   * The row under the list was a LINK to `/conversations`, which is a
   * different question — a table with dates, counts and a delete — asked of
   * somebody who only wanted to see one more line. This grows the column
   * instead, and the history table stays where it is for the times the table
   * is what you want.
   *
   * Core's keyset is `last_message_at`, exactly as the history page reads it;
   * a row with none sorts LAST and has nothing older behind it, so the door
   * closes there rather than paging forever against the same cursor.
   */
  const showMore = async () => {
    const last = sessions?.[sessions.length - 1];
    if (!last || last.last_message_at === null || paging) return;
    setPaging(true);
    try {
      const older = await api.agentSessions(false, {
        before: last.last_message_at, limit: SESSION_ROWS,
      });
      setSessions((cur) => {
        /* de-duplicated on ID: two rows sharing a `last_message_at` can land
           on both sides of the cursor, and a repeated conversation in this
           column reads as the platform having lost track of which is which */
        const known = new Set((cur ?? []).map((one) => one.id));
        return [...(cur ?? []), ...older.filter((one) => !known.has(one.id))];
      });
      setHasMore(
        older.length >= SESSION_ROWS && older[older.length - 1]!.last_message_at !== null,
      );
    } catch {
      /* the button stays, so the answer to a refused page is pressing it
         again — a column that silently stops offering more is indistinguishable
         from one that has reached the end */
    } finally {
      setPaging(false);
    }
  };

  const activeSession = params.get("c");
  const view = params.get("view");
  const numbers = untitledNumbers(sessions ?? []);

  /*
   * THE THREE ARE ROWS, NOT BUTTONS.
   *
   * What stood here was three FILLED, full-width, centre-labelled `.btn`s on
   * `bg-surface-2`, stacked above a column whose only other content is a list
   * of start-aligned rows. Three slabs over a list read as a toolbar bolted
   * onto the sidebar, and they take the eye every time the column opens - from
   * the conversations, which are what somebody came here to find.
   *
   * The reference's shape is a NAVIGATION ROW: no fill at rest, the icon at
   * the reading start, the label beside it, and the same corner, gutters and
   * type size the conversation rows below already wear. The column then reads
   * as one list of places with a rule across its middle, which is what it is.
   *
   * THE CENTRING HELPER WENT WITH THE FILL. It existed to keep a LABEL
   * optically centred on a full-width button without the icon pulling it off
   * - a real problem, and one only a centred button has. A start-aligned row
   * has nothing to centre, so the glyph sits in the flow where it belongs and
   * the whole calculation disappears.
   */
  const appRow = (
    key: string,
    icon: ReactNode,
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={() => { onClick(); onLeave?.(); }}
      /* NO fixed height: the row takes it from its own padding, exactly as the
         conversation rows do, so the two halves of this column keep one
         rhythm without either of them naming a number. */
      className={sideMenuRowClass(active)}
    >
      {/* the icon gutter is always the same width, so the three labels line up
          with each other whatever glyph sits beside them */}
      <span className="grid h-4 w-4 shrink-0 place-items-center" aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <nav
      aria-label={t("sidebarLabel")}
      /*
       * THE BUTTONS HOLD STILL AND THE LIST SCROLLS.
       *
       * `overflow-hidden` on the column and the scroller one level in, on the
       * list alone — not on the whole nav. With the scroller here, "show more"
       * would push New conversation, Workflows and Agents off the top of the
       * column the moment the list outgrew the window: three controls that
       * have to be scrolled back to are three controls somebody stops using.
       * `h-full` is granted by the shell (`h-dvh`), so this column is bounded
       * without knowing anything about the page beside it.
       *
       * ITS OWN SHEET, NEARLY AT PAGE TONE (R23, then twice on the rendered
       * screen:, and then).
       *
       * Three passes, and the last two are the calibration. This carried
       * `border-e border-border bg-surface` — the third hairline drawing the
       * app as a set of panes — and the first pass took the whole class list,
       * hairline and ground together, which left the column exactly the colour
       * of the thread beside it: the seam went for the right reason and the
       * DISTINCTION went with it. The second pass gave it `glass-chrome`, the
       * rail's and the bar's class, which is too far the other way — this
       * column stands INSIDE the page beside a conversation, and the bar's
       * white reads as a second header rather than as a sidebar.
       *
       * `glass-soft` is the same tone and the same blur at a third of the
       * alpha, so it composites a few values above the ground: visibly its own
       * column, not its own pane. The separation from the thread is the TONE,
       * which is why there is no lip and no drop on it either.
       *
       * AND NOW A HAIRLINE ON TOP OF THE TONE. `border-fg/[.07]` is the SAME
       * ink as the rule dividing
       * the three controls from the list twenty lines below — one value for
       * every line this column draws, so its outer seam and its inner seam
       * read as one system rather than two separate decisions. Still no drop
       * and no lip: a hairline says "edge", a shadow would say "pane".
       */
      /*
       * IN THE SHEET the column is the sheet: it fills what the drawer gives
       * it and draws neither the `lg:` gate that hides it on a phone nor the
       * seam that separates it from a thread standing beside it — inside the
       * drawer there is no thread beside it, and a hairline down the edge of a
       * panel that is already floating over a scrim is the "no border layout"
       * directive undone at the one width it was never applied to. The sheet's
       * own `glass-chrome` carries the ground, so the soft tone is not
       * repeated here either.
       */
      className={sheet
        ? "flex h-full w-full min-w-0 flex-col overflow-hidden px-2 py-3"
        /* THE SIDE MENU'S ONE FACE (2026-09-15): the column reads its tokens
           from scaffold/sideMenu.ts, so the next page that grows a menu beside
           it wears this one. `hidden … lg:flex` is this page's own decision
           about WHEN the column is on screen, not part of its face. */
        : `${SIDE_MENU_COLUMN} hidden lg:flex`}
    >
      {/* ── the three ─────────────────────────────────────────────────────
          New conversation RESETS an already-started thread and is a harmless
          no-op on a blank one — bumping the reset on an empty composer would
          remount the screen and lose whatever was half-typed. With `?c=` or a
          view on the URL it has to clear them first, or "new conversation"
          would start the next one inside the last one's scope. */}
      <div className="flex flex-col gap-1.5">
        {appRow("new", <IconPlus width={14} height={14} />, tPlatform("newConversation"),
          view === null && activeSession === null,
          () => {
            if (activeSession !== null || view !== null) { router.replace("/"); return; }
            if (started) startNewConversation();
          })}
        {appRow("workflows", <IconZap width={14} height={14} />, tPlatform("workflows"),
          view === "workflows",
          () => { router.push({ pathname: "/", query: { view: "workflows" } } as never); })}
        {appRow("agents", <IconAgent width={14} height={14} />, tPlatform("agents"),
          view === "agents",
          () => { router.push({ pathname: "/", query: { view: "agents" } } as never); })}
        {/* INTEGRATIONS, UNDER THE AGENTS (user directive, 2026-09-16: "put
            integrations out of the main menu and in the sub menu in home
            under the agents"). The same row and the same pane: a connection
            is what an agent works through, and the two had been a rail apart. */}
        {appRow("integrations", <IconPlug width={14} height={14} />, tPlatform("integrations"),
          view === "integrations",
          () => { router.push({ pathname: "/", query: { view: "integrations" } } as never); })}
      </div>

      {/* ── the conversations, with no heading over them ─────────────────
          A rule rather than a word: the three above are controls and this is a
          list, which is a change of KIND the eye reads without being told. */}
      <div className="mb-1 mt-3 border-t border-fg/[.07]" aria-hidden />

      {/* THE ONE SCROLLING REGION of this column. `min-h-0` is what lets a
          flex child be SHORTER than its content, which is what makes
          `overflow-y-auto` mean anything here; `flex-1` gives it whatever the
          three buttons left. `scroll-quiet` is the thin bar the platform uses
          everywhere else. */}
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {sessions === null ? (
        <SkeletonLines lines={5} className="px-2" />
      ) : sessions.length === 0 ? (
        <p className="px-2 py-1 text-caption text-fg-subtle">{tPlatform("noConversations")}</p>
      ) : (
        <>
          {sessions.map((s) => {
            const label = s.title
              ?? tConversations("newChat", { n: digits(numbers.get(s.id) ?? 1, locale) });
            const active = activeSession === s.id && view === null;
            /* the run in flight, whichever conversation the reader is in */
            const working = live.streaming && live.sessionId === s.id;
            const stamp = s.last_message_at ?? s.created_at;
            return (
              /*
               * THE KEBAB IS A SIBLING OF THE LINK, NOT INSIDE IT. A link that
               * opens a conversation cannot also contain a control that
               * removes it — one nested in the other is a click target that
               * means two different things depending on the pixel, which is
               * the reason the rail's sign-out was never inside the profile
               * card either.
               */
              <div
                key={s.id}
                className="group/row relative"
                /* the share state is read when the CONTROLS APPEAR rather than
                   for twelve rows on mount: the kebab is what asks the
                   question, and hover is the first moment it can be pressed */
                onPointerEnter={() => { void loadShare(s.id); }}
                onFocus={() => { void loadShare(s.id); }}
              >
                <Link
                  href={{ pathname: "/", query: { c: s.id } } as never}
                  /* the EXACT date on hover, the way every relative stamp in
                     this product carries its precise one: the age is for
                     scanning and the title is for settling which day */
                  title={`${label} - ${formatDate(stamp, locale)}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onLeave?.()}
                  /*
                   * THE PADDING GROWS ON HOVER, THE TEXT DOES NOT MOVE.
                   * Reserving the controls' width permanently would shorten
                   * every title for a pair of controls that are almost never
                   * on screen; letting them overlap would put a menu glyph on
                   * top of a word. Growing the END padding only changes where
                   * the text CLIPS — its start, its size and the row's height
                   * are untouched, so nothing reflows and nothing jumps.
                   *
                   * AND IT HAS TO BE WIDE ENOUGH (user report, 2026-09-08: the
                   * age was printing on top of the last word). `pe-16` was
                   * 64px against a stamp measuring 55-70 plus a 28px kebab and
                   * its 4px inset, so everything past "a day ago" overlapped
                   * the title — the exact failure the paragraph above says this
                   * padding exists to prevent. 7rem clears the widest of them.
                   *
                   * The title is its OWN element now rather than the link's
                   * text: `truncate` on the link clipped the whole flex line,
                   * so the dot and the ellipsis competed for the same edge.
                   */
                  className={`flex items-center gap-2 rounded-lg py-1.5 pe-2 ps-2 text-sm transition-[color,background-color,padding] group-hover/row:pe-28 ${
                    active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {/*
                    THE DOT CARRIES THE STATE; THE WORDS NEVER CHANGE COLOUR
                    — the title colour is constant on an active session, and
                    only the blinking dot and the ready dot carry state.

                    The open row used to be accent TEXT on an accent wash, and
                    a working row accent text without one — two meanings on
                    one tint, so a list holding both said "important" twice and
                    "which" never. Titles are one colour throughout now, and
                    the only difference between rows is a 6px dot:

                      · blinking accent — a run is in flight on this thread,
                        wherever the reader happens to be looking
                      · green — the open conversation, answered and waiting
                        for the next thing you type
                      · quiet — a stored conversation, nothing doing

                    The dot is on EVERY row, so the titles start on one line
                    and none of them moves when a state changes.
                  */}
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      working
                        ? "animate-pulse bg-accent"
                        : active ? "bg-success" : "bg-border"
                    }`}
                  />
                  {/* what the dot says, for a reader who cannot see it: colour
                      was the only announcement before, and colour is not one */}
                  {working ? <span className="sr-only">{tCommon("loading")}</span> : null}
                  <span className="truncate">{label}</span>
                </Link>
                {/*
                  HOVER REVEALS THE AGE AND THE MENU.

                  `focus-within` as well as `hover`, or the menu would be a
                  control only a mouse can reach: it is in the tab order the
                  whole time and would otherwise take focus while invisible.
                  `pointer-events-none` while hidden so an invisible strip
                  cannot swallow a press meant for the row underneath it.
                */}
                <span className="pointer-events-none absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
                  <span className="badge-num whitespace-nowrap text-micro text-fg-subtle">
                    {formatTimeAgo(stamp, locale)}
                  </span>
                  <KebabMenu
                    /* the same words every row menu in the product wears —
                       one label for one control, wherever it appears */
                    label={tTable("rowActions")}
                    items={[{
                      key: "share",
                      /* the label states the CURRENT fact and the press
                         reverses it, exactly as the toolbar button did: a menu
                         row reading "share" on an already-shared conversation
                         is a control that undoes without saying so */
                      label: (shareOf[s.id] ?? false)
                        ? tPlatform("sharedWithOrg")
                        : tPlatform("share"),
                      icon: <IconShare width={14} height={14} />,
                      onSelect: () => { void toggleShare(s.id); },
                    }, {
                      key: "export",
                      label: tPlatform("exportMd"),
                      icon: <IconDownload width={14} height={14} />,
                      onSelect: () => { void exportMarkdown(s.id, label); },
                    }, {
                      key: "delete",
                      label: tConversations("delete"),
                      icon: <IconTrash width={14} height={14} />,
                      danger: true,
                      /* the press ASKS; the write lives in the dialog below —
                         the platform's destructive-action rule */
                      onSelect: () => setCondemned(s),
                    }]}
                  />
                </span>
              </div>
            );
          })}
          {/* only when the last answer said there is more behind it — a
              "show more" that shows nothing is a control that teaches, on its
              first press, that the feature does not work */}
          {hasMore ? (
            <button
              type="button"
              disabled={paging}
              onClick={() => { void showMore(); }}
              className="rounded-lg px-2 py-1 text-start text-caption text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-60"
            >
              {paging ? tCommon("loading") : t("showMore")}
            </button>
          ) : null}
        </>
      )}
      </div>

      {/*
        The platform's ONE destructive-action dialog, naming the conversation
        the way the row names it — an untitled one keeps its number, so the
        dialog and the line it came from agree about which thread this is.

        Removal is ARCHIVE under the hood: nothing in the product may DELETE a
        conversation row (the audit survives), and an archived one never
        returns to any list — so it is a delete to the person pressing it, and
        the word on the button is theirs.

        The failure is SHOWN, never swallowed: a refused archive reported as
        success would leave the row on screen looking like a control that does
        nothing.
      */}
      {condemned !== null ? (
        <ConfirmDialog
          title={tConversations("deleteConfirmTitle", {
            title: condemned.title
              ?? tConversations("newChat", { n: digits(numbers.get(condemned.id) ?? 1, locale) }),
          })}
          body={tConversations("deleteConfirmBody")}
          confirmLabel={tConversations("delete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setCondemned(null)}
          onConfirm={() => {
            const target = condemned;
            setCondemned(null);
            void api.archiveSession(target.id, true)
              /* the BUS, not a local refetch: the history table and this
                 column read the same list, and a conversation removed here
                 must not still be sitting in that table one press away */
              .then(() => announceChange("sessions"))
              .catch(() => notify(tConversations("deleteFailed"), "warn"));
          }}
        />
      ) : null}
    </nav>
  );
}

/**
 * THE SAME COLUMN, ON A PHONE (2026-09-08 — fixing the mobile view against the
 * new home page).
 *
 * The column above is `lg:flex`, for the good reason its own comment gives: a
 * 72px rail plus a 256px column plus a readable conversation do not fit at
 * once. What that left below `lg` was not a narrower Home — it was a Home with
 * NO door to any of it. New conversation, Workflows, Agents and every stored
 * conversation live in that column and nowhere else; `/workflows` and
 * `/agents` redirect INTO it, so on a phone they resolved to a page whose
 * sidebar is not rendered. Measured at 375: the three buttons and the session
 * list were absent from the document, and no control anywhere on the screen
 * opened them.
 *
 * **A slide-over, and the same component inside it.** The sheet borrows the
 * bottom bar's own reasoning about direction: it opens at the inline-START —
 * the side the rail occupies from `md` up — written logically, so Persian gets
 * it on the right without a mirrored copy of this file.
 *
 * **It closes when a row navigates**, which is why `HomeSidebar` takes
 * `onLeave` rather than this file listening for a URL change: pressing «New
 * conversation» on an already-blank composer changes no URL, and a drawer that
 * stays open over the answer to what you just pressed is a drawer people close
 * by hand every time.
 */
export function HomeConversationsSheet() {
  const t = useTranslations("home");
  const [open, setOpen] = useState(false);
  /* THE DOOR MOVED UP A ROW. The top bar keeps a start-edge slot for the
     page's own menu and Home is its one filler; the button below is portalled
     into it, so the strip this component used to draw under the bar is gone
     and the phone gets that row back. Same button, same handler, same sheet —
     only its host changes. */
  const topbarMenuHost = useSyncExternalStore(
    subscribePageMenuAnchor,
    getPageMenuAnchorSnapshot,
    getServerPageMenuAnchorSnapshot,
  );

  /* Escape closes it — the one keyboard contract every overlay in the product
     honours, and the cheapest half of a dialog to get wrong by omission */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = (host: HTMLElement | null) => {
    const button = (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={t("sidebarLabel")}
        title={t("sidebarLabel")}
        className="btn-ghost btn-icon-sm glass-raised lg:hidden"
      >
        <IconMenu width={16} height={16} />
      </button>
    );
    return host
      ? createPortal(button, host)
      : <div className="flex items-center gap-2 px-3 pt-2 lg:hidden">{button}</div>;
  };

  return (
    <>
      {/* THE DOOR. It was drawn in Home's own column on the reasoning that the
          bar is shared chrome and a control existing on one page belongs on
          that page — which is still true of the OWNERSHIP and was wrong about
          the PLACE: the bar keeps one slot per owner, so a page can fill one
          without a control of another page's ever being on screen here. Home
          still owns this button; the bar only lends it a row. */}
      {/* A HAMBURGER, NOT A LABELLED PILL. The pill spelled its own name —
          "Conversations" beside a
          history glyph — which is the one control on a phone that never needs
          to: three rules at the top of a screen is the web's most-read
          sentence, and the panel it opens says what it is the moment it is
          open. The word cost a third of a narrow row to repeat what the
          drawer already announces.
          The label lives on as `aria-label` and `title`, so nothing was lost
          for a screen reader or a hover — only the ink. */}
      {/* IT LIVES IN THE BAR NOW, and it FALLS BACK. The host is another
          component's element: when the bar is absent — a surface that renders
          this sheet without the platform shell — the portal renders nothing,
          and a drawer with no handle is a drawer nobody opens. So the strip
          survives as the fallback, never as a second door: the portal wins
          whenever the bar is on screen. (The same shape AssistantSidebar's
          trigger already takes.) */}
      {trigger(topbarMenuHost)}

      {open ? (
        <>
          {/* the scrim is the bottom bar's, character for character: one
              spelling of "the page is behind something" in the shell */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("sidebarLabel")}
            /* `glass-solid`, not `glass-soft`: over a scrim this panel IS the
               window's chrome for as long as it is open, and the soft tone —
               calibrated to sit a few values above the page it stands beside —
               composites to almost nothing over a darkened screen. */
            className="glass-solid fixed bottom-0 start-0 top-0 z-50 flex w-[17rem] max-w-[86vw] flex-col rounded-se-2xl shadow-island lg:hidden"
          >
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                title={t("close")}
                className="btn-ghost btn-icon-sm"
              >
                <IconClose width={14} height={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <HomeSidebar sheet onLeave={() => setOpen(false)} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
