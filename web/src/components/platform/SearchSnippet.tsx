"use client";

/**
 * Renders core/'s `<mark>` highlights WITHOUT innerHTML.
 *
 * Splitting on the tag pair is a whitelist BY CONSTRUCTION: only `<mark>`
 * can ever become an element, and every other piece is handed to React as a
 * string child, so anything else tag-shaped stays literal text and is
 * escaped. That matters because the snippet derives from transcript text,
 * which is untrusted input — the server's guarantee about what it emits is
 * not a reason to render it as HTML.
 *
 * Marks may be absent entirely: matching is Persian-folded server-side, but
 * folding deletes ZWNJ, so highlighting runs against the RAW text and a hit
 * that matched only via the fold comes back correct but unmarked. This has
 * to look right with zero marks, and it does — the whole snippet is then one
 * unmarked chunk. Never re-fold here to recover them: a second normalisation
 * rule would drift from the index it is meant to mirror.
 *
 * IT LIVES HERE, not on the search page, because there are two surfaces now
 * (2026-09-08: the top bar's box shows its own hits). A tag whitelist is
 * exactly the kind of thing that must not be copied — the copy is the one
 * that gets the escaping subtly wrong, and it is the copy nobody re-reads.
 */
export function Snippet({
  text,
  className = "text-sm leading-7 text-fg-muted",
}: {
  text: string;
  className?: string;
}) {
  // odd indices are the captured group — i.e. the marked runs
  const pieces = text.split(/<mark>([\s\S]*?)<\/mark>/g);
  return (
    <p className={className}>
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent/20 px-0.5 text-fg">
            {piece}
          </mark>
        ) : (
          piece
        ),
      )}
    </p>
  );
}
