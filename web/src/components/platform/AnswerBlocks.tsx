"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Icon, type IconName } from "@/components/icons";
import { Markdown } from "@/components/ui/markdown";
import {
  parseAnswerBlocks,
  refHref,
  type AnswerBlock,
  type AnswerRef,
  type RefKind,
} from "@/lib/answerBlocks";
import { humanInstant } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * AN ASSISTANT ANSWER, RENDERED — prose as markdown, islands as components.
 *
 * **Why this is its own module and not a pair of copies.** It rendered inside
 * `ConversationThread`, and the assistant panel — the same answers, the same
 * model, the same instruction teaching it the block syntax — rendered
 * `<Markdown>` alone. So a checklist the model emitted came out on the Hub as
 * a checklist and in the sidebar as a wall of JSON in a code fence (reported
 * 2026-09-08, with the two screenshots side by side). That was not a styling
 * bug: the panel had never been given the parser. One renderer, two surfaces,
 * and the failure cannot recur by omission.
 *
 * **`compact` is the panel's 30% column, not a second design.** Same blocks,
 * same tokens, same order; tiles fall to two per row, paddings step down one
 * notch, and the table keeps its own scroller instead of widening the panel.
 * A separate "sidebar variant" would be a second thing to keep matching.
 *
 * ── THE TWO INLINE SEAMS ──────────────────────────────────────────────────
 *
 * Markdown emits BLOCKS, and this answer has an inline element on either end
 * of it: the speaker's name leads the first line
 * and the typing caret follows the last character. A `<p>` between them would
 * put «اکو:» on a line of its own and drop the caret to a line of its own,
 * undoing both.
 *
 * So the wrapper is `contents` — it stops being a box, and the paragraphs
 * become participants in the message's own block flow rather than children of
 * a div nested inside it — and two paragraphs are made inline:
 *
 *  - the FIRST one of the FIRST segment, so the name and the answer's opening
 *    words share a line. `mt-2` is restored on whatever follows it, because an
 *    inline box's vertical margins are ignored and the paragraph after it
 *    would otherwise sit flush against it.
 *  - the LAST one, WHILE STREAMING ONLY, so the caret sits where the next
 *    character will be. Not applied once the answer settles: there is nothing
 *    to keep in lane then, and `last:mb-0` already zeroes the margin the
 *    inline form would have discarded anyway.
 *
 * Both are `p:` specifically. A heading or a list as the first block legitimately
 * starts its own line — a heading sharing a line with the speaker's name would
 * read as part of the name.
 */
export function AnswerContent({
  text,
  streaming,
  compact = false,
}: {
  text: string;
  streaming?: boolean | undefined;
  /** The assistant panel's narrow column. Same blocks, one notch down. */
  compact?: boolean;
}) {
  const segments = parseAnswerBlocks(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <Markdown
            key={i}
            content={segment.text}
            className={cn(
              "contents",
              i === 0 && "[&>p:first-child]:inline [&>p:first-child+*]:mt-2",
              streaming && i === segments.length - 1 && "[&>p:last-child]:inline",
            )}
          />
        ) : (
          <BlockView key={i} block={segment.block} compact={compact} />
        ),
      )}
    </>
  );
}

/**
 * The island frame — R7's WELL, in the theme's own material.
 *
 * An island is a block inside the answer inside the thread, which is the exact
 * thing `.well` names: a row recessed a step inside a card, with no shadow of
 * its own (a shadow inside a shadowed sheet is mud). So it is `glass-raised`
 * at the well's corner and NOT a hand-drawn card — R23 took the hairline off
 * every surface in the product, and a bordered rectangle in an answer would be
 * the one boxed thing left on a glass page.
 *
 * `.well`'s own padding is not applied here and the class is not composed,
 * because these blocks reach the frame's edge — a table's rows, a header's
 * rule, a checklist's count strip — so the inset belongs to each part rather
 * than to the frame. What the frame owns is the material and the corner, which
 * is what has to match.
 *
 * The rules INSIDE it stay: a divider between a title and the rows it names is
 * a rule within one surface, which is what R23 keeps and PanelHeader's own
 * divider has been since 2026-09-02.
 */
function Island({
  title,
  compact,
  className,
  children,
}: {
  title?: string | undefined;
  compact: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("glass-raised my-2 overflow-hidden rounded-xl", className)}>
      {title !== undefined && title !== "" ? (
        <p
          className={cn(
            "border-b border-border text-group-label font-semibold text-fg-muted",
            compact ? "px-2.5 py-1.5" : "px-3 py-2",
          )}
        >
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function BlockView({
  block,
  compact = false,
}: {
  block: AnswerBlock;
  compact?: boolean;
}) {
  const pad = compact ? "px-2.5 py-2" : "px-3 py-2.5";
  /*
   * A DATE SLOT IS RENDERED, NOT ECHOED. The model fills these cells from
   * tool results, where an instant is the wire's ISO string; left alone, a
   * "When" column reads `2026-09-09T13:22:47.105Z` in UTC. `humanInstant`
   * rewrites a cell that IS an instant into the product's own date and
   * leaves every other cell exactly as written — see its own note.
   */
  const locale = useLocale();
  const when = (text: string) => humanInstant(text, locale);

  if (block.kind === "table") {
    /* the scroller is the wrapper, not the table: a wide table scrolls inside
       the answer instead of widening the thread — or the 30% panel */
    return (
      <Island compact={compact} className="overflow-x-auto">
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="border-b border-border">
              {block.columns.map((column, i) => (
                <th key={i} className="px-3 py-1.5 text-start font-semibold text-fg">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-1.5 text-fg-muted">{when(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Island>
    );
  }

  if (block.kind === "checklist") {
    const done = block.items.filter((item) => item.done).length;
    return (
      <Island compact={compact}>
        <ul className={cn("space-y-1.5", pad)}>
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-detail">
              {/*
                THE BOX IS A GLYPH, NOT AN `<input>`. This is the record of
                what the assistant wrote; a checkbox a reader can tick changes
                nothing anywhere while looking exactly like one that would —
                the same call `ui/markdown` makes for GFM task lists.
              */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border",
                  item.done
                    ? "border-transparent bg-accent text-on-accent"
                    : "border-border-strong text-transparent",
                )}
              >
                <Icon name="check" size="xs" />
              </span>
              <span className={item.done ? "text-fg-subtle line-through" : "text-fg"}>
                {item.text}
              </span>
            </li>
          ))}
        </ul>
        {/* the count is the one thing a list of ticks does not say at a glance */}
        {done > 0 ? (
          <p className={cn("border-t border-border text-group-label text-fg-subtle", compact ? "px-2.5 py-1" : "px-3 py-1.5")}>
            <span className="ltr">{done}/{block.items.length}</span>
          </p>
        ) : null}
      </Island>
    );
  }

  if (block.kind === "timeline") {
    return (
      <Island compact={compact}>
        <ol className={cn("space-y-2.5", pad)}>
          {block.items.map((item, i) => (
            <li key={i} className="relative flex gap-2.5 text-detail">
              {/* the rail is drawn per item and stops at the last one, so the
                  line never hangs below the final event */}
              <span aria-hidden className="relative flex w-2 shrink-0 justify-center">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-accent" />
                {i < block.items.length - 1 ? (
                  <span className="absolute top-4 bottom-[-14px] w-px bg-border" />
                ) : null}
              </span>
              <span className="min-w-0">
                {item.when ? (
                  <span className="block text-group-label font-semibold text-accent">{when(item.when)}</span>
                ) : null}
                <span className="text-fg">{item.what}</span>
              </span>
            </li>
          ))}
        </ol>
      </Island>
    );
  }

  if (block.kind === "stats") {
    return (
      <Island compact={compact} title={block.title}>
        {/*
          TILES SEPARATED BY AIR, NOT BY LINES. The first draft drew a hairline
          grid (`gap-px` over a border-coloured ground, each tile opaque) —
          which needs an OPAQUE tile to hide the ground behind it, and an
          opaque patch inside a glass sheet is the one thing R23 removed. The
          label's own quiet tone is what groups a figure with its name; the
          spacing is what separates one tile from the next.
        */}
        <div
          className={cn(
            "grid gap-x-4 gap-y-3",
            pad,
            compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {block.items.map((item, i) => (
            <div key={i} className="min-w-0">
              <p className="truncate text-group-label text-fg-subtle">{item.label}</p>
              <p className="mt-0.5 text-base font-semibold text-fg">{when(item.value)}</p>
              {item.hint ? (
                <p className="mt-0.5 text-group-label text-fg-subtle">{item.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Island>
    );
  }

  if (block.kind === "chart") {
    /*
     * The scale is the LARGEST bar, and it is computed from the data rather
     * than assumed to be 100: an assistant charting «۳ تسک، ۵ تسک» against a
     * fixed hundred draws two slivers and says nothing. A single zero-valued
     * series would divide by zero, so the floor is 1.
     */
    const max = Math.max(1, ...block.series.map((point) => Math.abs(point.value)));
    return (
      <Island compact={compact} title={block.title}>
        <ol className={cn("space-y-2", pad)}>
          {block.series.map((point, i) => (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-2 text-group-label">
                <span className="min-w-0 truncate text-fg">{point.label}</span>
                <span className="ltr shrink-0 font-semibold text-fg-muted">
                  {point.value}{block.unit ? ` ${block.unit}` : ""}
                </span>
              </div>
              {/*
                The bar is DECORATION — `aria-hidden`. The label and the figure
                above it are the data, already read in order by a screen
                reader, so the track would otherwise be announced as a third,
                empty thing on every row.
              */}
              {/* the track is `border`, not a surface tone: a surface behind a
                  translucent sheet is invisible, and a groove has to be seen */}
              <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ inlineSize: `${Math.max(2, (Math.abs(point.value) / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      </Island>
    );
  }

  return <RefsBlock items={block.items} compact={compact} />;
}

const REF_ICON: Record<RefKind, IconName> = {
  call: "voice",
  meeting: "calendar",
  task: "checkCircle",
  project: "folder",
};

/**
 * WHAT THE ANSWER WAS DRAWN FROM.
 *
 * The assistant reads calls, meetings, tasks and projects through its tools
 * and then describes them in prose — where the record it read is unreachable.
 * The reader is told «طبق جلسهٔ سه‌شنبه…» and left to go find which meeting
 * that was. These chips are that record, addressable.
 *
 * **A chip with no id does not become a link.** The ids are model-authored,
 * and a link into `/calls/undefined` is worse than no link: it looks like the
 * product knows where the thing is. The parser already reduced an ill-formed
 * id to `null`; here that renders as the same chip, inert, so the reader is
 * still told what was consulted and simply is not promised a destination.
 */
function RefsBlock({ items, compact }: { items: AnswerRef[]; compact: boolean }) {
  const t = useTranslations("platform");
  const locale = useLocale();
  /* the ONE bordered shape here, and it is a control: a chip that opens a
     record owes the 3:1 edge a field owes, which is the line R23 drew */
  const chip =
    "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-group-label";

  return (
    <div className="my-2">
      <p className="mb-1.5 text-group-label font-semibold text-fg-subtle">{t("answerSources")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((ref, i) => {
          const href = refHref(ref);
          const inner = (
            <>
              <Icon name={REF_ICON[ref.kind]} size="xs" className="shrink-0 text-fg-subtle" />
              <span className={cn("truncate", compact && "max-w-[13rem]")}>{ref.title}</span>
              {ref.when ? <span className="shrink-0 text-fg-subtle">{humanInstant(ref.when, locale)}</span> : null}
            </>
          );
          return (
            <li key={i} className="min-w-0">
              {href === null ? (
                <span className={cn(chip, "text-fg-muted")}>{inner}</span>
              ) : (
                <Link
                  href={href}
                  className={cn(chip, "text-fg transition-colors hover:border-border-strong hover:text-accent")}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
