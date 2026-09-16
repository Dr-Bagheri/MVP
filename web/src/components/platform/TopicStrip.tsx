"use client";

import { useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { KebabMenu } from "@/components/rowActions";
import { IconFolder, IconPencil, IconPlus, IconTrash } from "@/components/icons";
import { digits } from "@/lib/format";
import { FILTER_COUNT, FILTER_TRACK, filterChipClass } from "./sectionTabs";
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
 * The chip is `filterChipClass` — the kit's row-two pill — and the row is
 * `FILTER_TRACK` (RULEBOOK §2: a third row is row two's rail again).
 * `topicStrip.guard.test.ts` refuses a second drawing of a folder chip.
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
  placeholder: string;
  cancel: string;
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
      <KebabMenu
        label={optionsLabel}
        triggerClassName="h-5 w-5 rounded text-current opacity-60 hover:opacity-100"
        items={items}
      />
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
      className="btn btn-icon border border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg"
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
  children,
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
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  /** ARCHIVED, never deleted — the things in it are re-pointed by the schema */
  onArchive: (id: string) => Promise<unknown>;
  /** re-read after any write, success or refusal — the row must show the truth */
  onDone: () => void;
  onRefused: () => void;
  /** appended after the `+`: the task board's projects section */
  children?: ReactNode;
}) {
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const settle = () => { setAdding(false); setRenaming(null); onDone(); };
  const write = (p: Promise<unknown>) => {
    void p.then(settle).catch(() => { onRefused(); settle(); });
  };

  return (
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
          items={[
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
              onSelect: () => write(onArchive(topic.id)),
            },
          ]}
        />
      ))}

      {adding || renaming !== null ? (
        <TopicNameBox
          initial={renaming?.name ?? ""}
          placeholder={labels.placeholder}
          cancelLabel={labels.cancel}
          onCancel={() => { setAdding(false); setRenaming(null); }}
          onSubmit={(name) => {
            const target = renaming;
            write(target !== null ? onRename(target.id, name) : onCreate(name));
          }}
        />
      ) : (
        <TopicAddButton label={labels.add} onClick={() => setAdding(true)} />
      )}

      {children}
    </div>
  );
}
