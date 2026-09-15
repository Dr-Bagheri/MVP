"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { SearchHit } from "@/api/types";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { IconFileText, IconRows, IconSearch, IconVoice } from "@/components/icons";
import { formatClock, formatDate } from "@/lib/format";
import { Snippet } from "./SearchSnippet";

/**
 * THE TOP BAR'S SEARCH BOX, WHICH IS A COMMAND PALETTE.
 *
 * What it replaces: a bare `<form>` that did nothing until Enter and then
 * left the page for `/search`. Every keystroke was a bet that the corpus had
 * the word, paid for with a navigation — and the answer to "is this record
 * even in here" is worth one round trip, not a page.
 *
 * THREE THINGS THIS IS NOT, each of them a road already taken here:
 *
 *  · It is not a hand-rolled panel. `absolute top-full` under a field is the
 *    shape popover.guard.test.tsx bans by name, and for the reasons it lists:
 *    this bar is `overflow-visible` today and the first ancestor that is not
 *    would clip the panel to a sliver. It goes through `Popover`, portalled.
 *  · It is not a second search. `api.search` is the same call `/search` runs,
 *    and the `<mark>` whitelist is the page's own `Snippet`, imported. Two
 *    parsers for untrusted transcript text is one parser too many.
 *  · It is not the whole result set. Eight rows and a door to the page — a
 *    panel that scrolls forever is a page wearing a panel's clothes.
 */

/**
 * The reading order, and it is deliberate: a TITLE match is the strongest
 * thing search can say ("this record is called that"), a transcript match is
 * a moment inside one, and a summary match is a claim about the whole. The
 * server returns them mixed; grouping is what turns a list into an answer,
 * and it is what the reference does with its own sections.
 */
const GROUPS = [
  { kind: "call", labelKey: "searchGroupCall", Glyph: IconFileText },
  { kind: "transcript", labelKey: "searchGroupTranscript", Glyph: IconVoice },
  { kind: "summary", labelKey: "searchGroupSummary", Glyph: IconRows },
] as const;

/** the panel shows a HANDFUL; the page shows the corpus */
const SHOWN = 8;

/** core 400s below two characters — the box says so rather than asking */
const MIN_QUERY = 2;

export function GlobalSearch() {
  const t = useTranslations("platform");
  const tSearch = useTranslations("search");
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /*
   * THE STALE-ANSWER GUARD. Typing "reza" fires four requests and they can
   * land in any order; without a sequence the panel can settle on the answer
   * to "rez" while the field says "reza" — results that are correct about a
   * question nobody asked any more, which is indistinguishable from wrong.
   */
  const seq = useRef(0);

  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_QUERY;

  /* the flat reading order the ARROWS walk: groups in the order above, then
     the door to the page as the last stop. The panel renders these grouped;
     the keyboard needs them as one line, and computing both from one array is
     what keeps the highlight and the click on the same row. */
  const ordered = useMemo(() => {
    const rows = hits ?? [];
    return GROUPS.flatMap((g) => rows.filter((h) => h.kind === g.kind)).slice(0, SHOWN);
  }, [hits]);
  const allIndex = ordered.length;
  /*
   * THE DOOR TO THE PAGE IS DRAWN ONLY OVER AN ANSWER.
   *
   * It used to render from the first keystroke, under the hint and under the
   * searching line — so «all results for «d»» sat beneath a panel that was
   * telling the reader it had nothing yet, and offered to open a page of
   * results for a query nobody had answered. A door is only worth drawing
   * once there is a room behind it.
   *
   * ENTER STILL REACHES IT while the row is hidden, and that is deliberate
   * rather than an oversight: a key press is not a claim on screen, and a
   * reader who types a word and presses Enter means the search page — which
   * is exactly what this box did before it had a panel at all.
   *
   * The condition is "ROWS ARE ON SCREEN", not "nothing is in flight". The
   * two differ on the keystroke AFTER an answer: the panel keeps the rows it
   * has while the next request runs, and a door tied to `busy` would blink
   * out and back on every letter typed into a query that is already
   * answering — a flicker on the one control the reader is aiming at.
   */
  const doorShown = ready && hits !== null && ordered.length > 0;
  /** the last arrow stop: the door when it is drawn, else the last row */
  const lastIndex = doorShown ? allIndex : Math.max(0, allIndex - 1);

  /*
   * DEBOUNCED, and the trailing edge is the point: search-as-you-type at one
   * request per keystroke asks core/ to scan the corpus eight times to answer
   * the eighth question. 220ms is under the pause between words and over the
   * gap between letters.
   */
  useEffect(() => {
    if (!ready) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void api
        .search(trimmed)
        .then((rows) => {
          if (seq.current !== mine) return;
          setHits(rows);
          setCursor(0);
          setBusy(false);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          /* an empty list, NOT a thrown boundary: the bar must survive a
             search outage. `hits = []` renders the empty state, which is the
             honest reading of "we have nothing to show you". */
          setHits([]);
          setBusy(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [trimmed, ready]);

  const goToPage = useCallback(() => {
    if (!ready) return;
    setOpen(false);
    router.push({ pathname: "/search", query: { q: trimmed } });
  }, [ready, router, trimmed]);

  const openHit = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(`/calls/${hit.call_id}`);
    },
    [router],
  );

  const activate = useCallback(
    (index: number) => {
      const hit = ordered[index];
      if (hit) openHit(hit);
      else goToPage();
    },
    [goToPage, openHit, ordered],
  );

  /*
   * Cmd/Ctrl+K reaches the field from anywhere. It carried a ⌘K badge until
   * that badge was dropped (2026-09-08) — the KEY stays because nothing
   * about it was the complaint, and an unadvertised shortcut costs a reader
   * who never learns it exactly nothing. The reverse is what this repo bans:
   * a badge naming a key that does nothing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" && trimmed !== "") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c >= lastIndex ? 0 : c + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? lastIndex : c - 1));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        {/* THE BOX. One fixed width, open or closed: the panel takes the
            anchor's width, so the field and its results share a single
            measurement without the field resizing under the cursor. */}
        <form
          ref={formRef}
          role="search"
          className="input-sm hidden w-80 min-w-0 items-center gap-2 focus-within:border-accent lg:flex"
          onSubmit={(e) => {
            e.preventDefault();
            activate(cursor);
          }}
        >
          <IconSearch width={14} height={14} className="shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            name="q"
            value={query}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open ? `${listId}-${cursor}` : undefined}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
            placeholder={t("searchEverything")}
            aria-label={t("searchEverything")}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
              setOpen(e.target.value.trim() !== "");
            }}
            onKeyDown={onKeyDown}
          />
          {/* THE DIRECTIVE, in the onChange above: the box opens on TYPING.
              Not on focus — a panel that appears because a pointer passed
              through the field is a panel that appears when nobody asked. */}
        </form>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] glass-chrome rounded-xl p-0 shadow-island"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (formRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {/* focus NEVER leaves the field (the two `AutoFocus` handlers above).
            Radix focuses its content on open, which would take the caret out
            of the input mid-word and send the next keystroke nowhere — this
            panel is a readout of what the field is doing, not a place to
            stand. And the field is OUTSIDE the portalled content, so clicking
            back into it counts as interacting outside and would otherwise
            close the panel the click was aimed at keeping. */}
        <Results
          listId={listId}
          cursor={cursor}
          setCursor={setCursor}
          ordered={ordered}
          allIndex={allIndex}
          doorShown={doorShown}
          hits={hits}
          busy={busy}
          ready={ready}
          query={trimmed}
          locale={locale}
          onPick={activate}
          t={t}
          tSearch={tSearch}
        />
      </PopoverContent>
    </Popover>
  );
}

type Translate = (key: string, values?: Record<string, string>) => string;

function Results({
  listId, cursor, setCursor, ordered, allIndex, doorShown, hits, busy, ready, query, locale, onPick, t, tSearch,
}: {
  listId: string;
  cursor: number;
  setCursor: (index: number) => void;
  ordered: SearchHit[];
  allIndex: number;
  doorShown: boolean;
  hits: SearchHit[] | null;
  busy: boolean;
  ready: boolean;
  query: string;
  locale: string;
  onPick: (index: number) => void;
  t: Translate;
  tSearch: Translate;
}) {
  /* one running index across the groups, so the row the arrows highlight and
     the row a pointer lands on are the same row */
  let flat = -1;

  return (
    <div className="flex max-h-[26rem] flex-col">
      <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!ready ? (
          <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{t("searchHint")}</li>
        ) : busy && hits === null ? (
          <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{t("searchBusy")}</li>
        ) : ordered.length === 0 ? (
          <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{tSearch("empty")}</li>
        ) : (
          GROUPS.map((group) => {
            const rows = ordered.filter((hit) => hit.kind === group.kind);
            if (rows.length === 0) return null;
            const Glyph = group.Glyph;
            return (
              <li key={group.kind} className="mb-1 last:mb-0">
                {/* the group heading is a LABEL, not an option: it sits in the
                    list's box but outside the row set, which is why the
                    options below it are their own `ul` */}
                <p className="px-2.5 pb-1 pt-1.5 text-group-label font-semibold text-fg-subtle">
                  {t(group.labelKey)}
                </p>
                <ul role="group">
                  {rows.map((hit) => {
                    flat += 1;
                    const index = flat;
                    return (
                      <Row
                        key={`${hit.call_id}-${hit.kind}-${hit.start_ms ?? "x"}-${index}`}
                        id={`${listId}-${index}`}
                        active={index === cursor}
                        onHover={() => setCursor(index)}
                        onPick={() => onPick(index)}
                        glyph={<Glyph width={14} height={14} />}
                        title={hit.call_title}
                        snippet={hit.snippet}
                        meta={
                          hit.start_ms !== null
                            ? formatClock(hit.start_ms / 1000, locale)
                            : hit.call_date
                              ? formatDate(hit.call_date, locale)
                              : ""
                        }
                      />
                    );
                  })}
                </ul>
              </li>
            );
          })
        )}
      </ul>

      {/* THE DOOR TO THE PAGE, drawn only once there is a room behind it —
          the panel's last arrow stop while it is here. `doorShown` carries
          the whole condition (a landed answer WITH rows in it) so the
          keyboard's last index and this row cannot disagree about whether
          it exists; the divider goes with the row, because a rule under
          nothing is a line drawn for its own sake. */}
      {doorShown ? (
        <div className="border-t border-fg/[0.07] p-1.5">
          <button
            type="button"
            id={`${listId}-${allIndex}`}
            onMouseEnter={() => setCursor(allIndex)}
            onClick={() => onPick(allIndex)}
            className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-xs transition-colors ${
              cursor === allIndex ? "bg-fg/[0.06] text-fg" : "text-fg-muted"
            }`}
          >
            <IconSearch width={14} height={14} className="shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{t("searchAll", { q: query })}</span>
            <kbd className="shrink-0 rounded bg-fg/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-fg-subtle">
              {t("searchEnter")}
            </kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  id, active, onHover, onPick, glyph, title, snippet, meta,
}: {
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  glyph: React.ReactNode;
  title: string;
  snippet: string;
  meta: string;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
        active ? "bg-fg/[0.06]" : ""
      }`}
    >
      {/* the reference's 60% glyph: present enough to sort the rows by kind
          at a glance, quiet enough not to compete with the words */}
      <span className="shrink-0 text-fg-muted opacity-60" aria-hidden>
        {glyph}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-fg">{title}</span>
        <Snippet text={snippet} className="truncate text-[11px] leading-4 text-fg-subtle" />
      </span>
      {meta !== "" ? <span className="ltr shrink-0 text-[10px] text-fg-subtle">{meta}</span> : null}
    </li>
  );
}
