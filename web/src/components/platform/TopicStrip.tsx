"use client";

import { useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { KebabMenu } from "@/components/rowActions";
import { IconFolder, IconPencil, IconPlus, IconTrash } from "@/components/icons";
import { digits } from "@/lib/format";
import { FILTER_COUNT, FILTER_TRACK, TOOLBAR_END, TOOLBAR_ROW, filterChipClass } from "./sectionTabs";
import { TopicNameBox } from "./TopicNameBox";

/**
 * THE FOLDER STRIP — the third row, ONE component for the two boards.
 *
 * User ruling, 2026-09-16: "all meetings should look like the projects with
 * the edit three dot in it and the plus after it for new one, and the place
 * in the third row. Unify."
 *
 * So the task board's strip — its «همه» chip, a chip per folder with its
 * count and its ⋯, the inline name box for adding and renaming, the dashed
 * `+` — is written here once and READ by both the task board and the
 * meetings page. It had been drawn inside TaskBoard.tsx while the meetings
 * page carried a dropdown and a menu beside it (2026-09-08), which was the
 * one place in the product where a folder was a different shape; and the
 * kit's own sentence about rows applies to strips: a person who has learned
 * one has learned both only while there is one.
 *
 * The strip OWNS the two pieces of interaction state a folder row has —
 * which folder is being added, which is being renamed — because a caller
 * holding them is a caller that can hold them differently. What a caller
 * supplies is the DATA (the folders and their counts) and the WRITES (create,
 * rename, archive), plus whatever it wants to append after the `+`: the task
 * board hangs its projects section there, through the same `TopicChip`.
 *
 * The chip is `filterChipClass` — the kit's `.filter-chip`, outlined, the accent's
 * edge and tint when on — and the row is `FILTER_TRACK`, a bare LINE of
 * chips with no rail under it (design «ج», 2026-09-17: "the folders as one
 * line of chips"). `topicStrip.guard.test.ts` refuses a second drawing of a
 * folder chip.
 */

export interface TopicStripItem {
  id: string;
  name: string;
  /** how many things sit in this folder, formatted here in the page's digits */
  count: number;
}

export interface TopicStripLabels {
  /** the accessible name of every ⋯ on the row */
  options: string;
  rename: string;
  remove: string;
  /** the `+`'s name and title */
  add: string;
  /** the inline box's words — absent when the `+` opens a dialog (`onAdd`) */
  placeholder?: string;
  cancel?: string;
}

export type TopicMenuItem = Parameters<typeof KebabMenu>[0]["items"][number];

/**
 * One chip: the toggle, its count, and a ⋯ whose items are the caller's — the
 * picture never differs between a plain folder and a project's folder, only
 * what the menu offers. Exported so the task board can draw its projects
 * with the same chip and a different menu.
 */
export function TopicChip({ name, count, glyph, active, onToggle, items, optionsLabel }: {
  name: string;
  count: number;
  glyph: ReactNode;
  active: boolean;
  onToggle: () => void;
  items: TopicMenuItem[];
  optionsLabel: string;
}) {
  const locale = useLocale();
  return (
    <span className={`${filterChipClass(active)} cursor-default pe-1`}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className="tap inline-flex items-center gap-1.5 hover:text-fg"
      >
        {glyph}
        {name}
        <span className={FILTER_COUNT}>{digits(count, locale)}</span>
      </button>
      {/* no ⋯ over an empty menu: a member on the projects page has nothing
          to edit or delete, and a button that opens nothing is a door that
          refuses */}
      {items.length > 0 ? (
        <KebabMenu
          label={optionsLabel}
          triggerClassName="h-5 w-5 rounded text-current opacity-60 hover:opacity-100"
          items={items}
        />
      ) : null}
    </span>
  );
}

/** the dashed `+` — the strip's own add control, one square for every kind of row */
export function TopicAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="btn-dashed btn-icon"
    >
      <IconPlus width={12} height={12} />
    </button>
  );
}

export function TopicStrip({
  allLabel,
  allCount,
  active,
  onSelect,
  topics,
  labels,
  glyph,
  onCreate,
  onRename,
  onArchive,
  onDone,
  onRefused,
  onAdd,
  menuFor,
  canAdd = true,
  children,
  end,
}: {
  allLabel: string;
  allCount: number;
  /** the selected folder's id, or "all" */
  active: string;
  onSelect: (id: string) => void;
  topics: readonly TopicStripItem[];
  labels: TopicStripLabels;
  /** the mark before a folder's name; the default is the board's green dot */
  glyph?: (topic: TopicStripItem) => ReactNode;
  onCreate?: (name: string) => Promise<unknown>;
  onRename?: (id: string, name: string) => Promise<unknown>;
  /** ARCHIVED, never deleted — the things in it are re-pointed by the schema */
  onArchive?: (id: string) => Promise<unknown>;
  /** re-read after any write, success or refusal — the row must show the truth */
  onDone?: () => void;
  onRefused?: () => void;
  /**
   * THE `+` OPENS SOMETHING ELSE (the projects page, 2026-09-16): a project
   * is more than a name — people, a tone, a summary — so its `+` opens the
   * whole dialog rather than the inline box. Given, the box is never drawn.
   */
  onAdd?: () => void;
  /**
   * A chip's own menu, in place of rename/archive (the projects page:
   * «ویرایش», «حذف»). An EMPTY list draws no ⋯ at all — a member on that
   * page may edit nothing, and a menu of nothing is a door that refuses.
   */
  menuFor?: (topic: TopicStripItem) => TopicMenuItem[];
  /** whether the `+` is offered at all — absent rather than disabled for
      somebody the wall refuses (0186: a project is an admin's act) */
  canAdd?: boolean;
  /** appended after the `+`: the task board's projects section */
  children?: ReactNode;
  /** the row's OTHER END: the meetings page's view switch and search key
      (2026-09-16), in the row's own end slot so the two sit at the edge the
      create button sits on in the row above */
  end?: ReactNode;
}) {
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const settle = () => { setAdding(false); setRenaming(null); onDone?.(); };
  const write = (p: Promise<unknown> | undefined) => {
    if (!p) { settle(); return; }
    void p.then(settle).catch(() => { onRefused?.(); settle(); });
  };
  /* the default menu: rename in the inline box, archive through the caller
     — used by every strip that did not bring its own */
  const defaultMenu = (topic: TopicStripItem): TopicMenuItem[] => [
    {
      key: "rename",
      label: labels.rename,
      icon: <IconPencil width={14} height={14} />,
      onSelect: () => { setAdding(false); setRenaming({ id: topic.id, name: topic.name }); },
    },
    {
      key: "remove",
      label: labels.remove,
      icon: <IconTrash width={14} height={14} />,
      danger: true,
      onSelect: () => write(onArchive?.(topic.id)),
    },
  ];

  return (
    /* THE ROW, THEN THE RAIL. A bare flex track is block-level and takes the
       page column's whole width — the tinted strip spanned the screen while
       row one's rails stopped at their last pill (user, 2026-09-16: "the
       second one is longer in tasks, make it the same as the top length").
       Inside the kit's own row — `TOOLBAR_ROW`, the flex-wrap row every
       Toolbar draws — the rail is as long as what is in it, like every other
       rail on the page. */
    <div className={TOOLBAR_ROW}>
    <div className={FILTER_TRACK}>
      <button
        type="button"
        aria-pressed={active === "all"}
        onClick={() => onSelect("all")}
        className={filterChipClass(active === "all")}
      >
        <IconFolder width={12} height={12} />
        {allLabel}
        <span className={FILTER_COUNT}>{digits(allCount, locale)}</span>
      </button>

      {topics.map((topic) => (
        <TopicChip
          key={topic.id}
          name={topic.name}
          count={topic.count}
          glyph={glyph ? glyph(topic) : <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />}
          active={active === topic.id}
          /* pressing the lit chip lifts the filter — «همه» is one press away
             either way, and a chip that can only be turned on is a chip
             somebody has to hunt for the way off */
          onToggle={() => onSelect(active === topic.id ? "all" : topic.id)}
          optionsLabel={labels.options}
          items={menuFor ? menuFor(topic) : defaultMenu(topic)}
        />
      ))}

      {adding || renaming !== null ? (
        <TopicNameBox
          initial={renaming?.name ?? ""}
          placeholder={labels.placeholder ?? ""}
          cancelLabel={labels.cancel ?? ""}
          onCancel={() => { setAdding(false); setRenaming(null); }}
          onSubmit={(name) => {
            const target = renaming;
            write(target !== null ? onRename?.(target.id, name) : onCreate?.(name));
          }}
        />
      ) : canAdd ? (
        /* the `+`: the inline box by default, or whatever the caller opens */
        <TopicAddButton label={labels.add} onClick={onAdd ?? (() => setAdding(true))} />
      ) : null}

      {children}
    </div>
    {end ? <div className={TOOLBAR_END}>{end}</div> : null}
    </div>
  );
}
