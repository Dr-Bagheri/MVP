"use client";

/**
 * The WORD-LIKE summary editor (user directive, 2026-08-25: "it should look
 * like a word text box with most of the options"). A contentEditable
 * surface showing the FORMATTED document — no raw ** markers — with a
 * toolbar of the operations the stored grammar can honestly round-trip.
 *
 * The record stores markdown-ish text (the grammar parseSummary reads:
 * ### / **heading:** headings, - bullets, 1. numbered, **bold**,
 * *italic*). The editor converts md → HTML on entry and HTML → md on every
 * input, so what leaves this component is exactly what SummaryBody can
 * render — an editor button that produced unrenderable formatting would be
 * a control writing state the reader cannot see.
 *
 * document.execCommand is deprecated-but-universal; for this bounded set
 * (bold, italic, lists, block format, undo/redo) it remains the only
 * dependency-free engine, and the md round-trip strips anything exotic a
 * paste might smuggle in.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SelectMenu } from "@/components/rowActions";

export function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<i>$2</i>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line === "") { closeList(); continue; }
    const heading =
      /^#{1,4}\s+(.+)$/.exec(line)?.[1]
      ?? /^\*\*(.+?)[:：]?\*\*[:：]?$/.exec(line)?.[1]
      ?? (line.length <= 60 && /[:：]$/.test(line) && !/[.؟?!]/.test(line)
        ? line.replace(/[:：]$/, "")
        : null);
    if (heading !== null) {
      closeList();
      out.push(`<h3>${inline(heading)}</h3>`);
      continue;
    }
    const bullet = /^[-*•–]\s+(.+)$/.exec(line);
    if (bullet) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

export function htmlToMd(root: HTMLElement): string {
  const lines: string[] = [];
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const inner = Array.from(node.childNodes).map(inline).join("");
    const tag = node.tagName;
    if (tag === "B" || tag === "STRONG") return inner.trim() === "" ? inner : `**${inner}**`;
    if (tag === "I" || tag === "EM") return inner.trim() === "" ? inner : `*${inner}*`;
    if (tag === "BR") return "\n";
    return inner;
  };
  const block = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push(text);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    if (/^H[1-4]$/.test(tag)) {
      lines.push(`### ${inline(node).trim()}`, "");
      return;
    }
    if (tag === "UL" || tag === "OL") {
      let n = 1;
      for (const li of Array.from(node.children)) {
        lines.push(tag === "UL" ? `- ${inline(li).trim()}` : `${n++}. ${inline(li).trim()}`);
      }
      lines.push("");
      return;
    }
    if (tag === "P" || tag === "DIV" || tag === "BLOCKQUOTE") {
      // a div holding only blocks recurses; a leaf div is a paragraph
      const hasBlockChild = Array.from(node.children)
        .some((c) => /^(H[1-4]|UL|OL|P|DIV|BLOCKQUOTE)$/.test(c.tagName));
      if (hasBlockChild) {
        Array.from(node.childNodes).forEach(block);
      } else {
        const text = inline(node).trim();
        lines.push(text === "" ? "" : text, ...(text === "" ? [] : [""]));
      }
      return;
    }
    const text = inline(node).trim();
    if (text) lines.push(text, "");
  };
  Array.from(root.childNodes).forEach(block);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function Btn({ label, onClick, children }: {
  label: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      /* mousedown-preventDefault keeps the editor's selection alive — a
         toolbar click must format the selection, not destroy it */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      /* 2026-09-03: the theme's control, not a twelfth invented size. This
         drew its own 32px box — the platform has no 32px control, so the one
         ribbon in the product sat between the 38px buttons on the card around
         it and the 34px section pills above it. (The corner was already the
         theme's: `rounded-md` is 11px in this config, not Tailwind's 6.)
         `.btn` owns height, padding, weight and centring, and already
         composes `.tap`; `min-w-8` went with them, because `.btn`'s px-15
         alone is wider than 32. Only the TONE is stated: a ghost toolbar
         button that fills on hover. */
      className="btn text-fg-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  fontScale = 1,
}: {
  /** the markdown-ish source of truth (what save submits) */
  value: string;
  onChange: (md: string) => void;
  fontScale?: number;
}) {
  const t = useTranslations("call");
  const ref = useRef<HTMLDivElement | null>(null);
  // seeded ONCE from the incoming value; afterwards the DOM is the working
  // copy and `value` is derived from it — resetting innerHTML on every
  // keystroke would throw the caret away
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !ref.current) return;
    ref.current.innerHTML = mdToHtml(value);
    seeded.current = true;
  }, [value]);

  const emit = () => {
    if (ref.current) onChange(htmlToMd(ref.current));
  };
  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  return (
    <div className="rounded-xl border border-border-strong focus-within:border-accent">
      {/* ── the Word-style ribbon ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        {/* 2026-09-03: the style picker's height moved WITH the buttons. It
            wore `h-8 min-h-0 py-0 text-xs`, which was not a size either —
            it was a hand-cut copy of the old 32px button beside it, and
            leaving it while the buttons became `.btn` would have put a
            mismatch INTO the ribbon that this pass exists to take out of it.
            Its trigger is a field, so it takes `.input`'s own height (40, 44
            below md) — the button/field pair the theme measured. Only the
            WIDTH is stated, because a picker in a wrapping row needs one. */}
        <SelectMenu
          className="w-32"
          ariaLabel={t("editorStyle")}
          value=""
          onChange={(v) => exec("formatBlock", v === "h" ? "<h3>" : "<p>")}
          options={[
            { value: "p", label: t("styleNormal") },
            { value: "h", label: t("styleHeading") },
          ]}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn label={t("editorBold")} onClick={() => exec("bold")}>
          <span className="font-black">B</span>
        </Btn>
        <Btn label={t("editorItalic")} onClick={() => exec("italic")}>
          <span className="italic">I</span>
        </Btn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn label={t("editorBullet")} onClick={() => exec("insertUnorderedList")}>
          <span className="font-bold">•≡</span>
        </Btn>
        <Btn label={t("editorNumbered")} onClick={() => exec("insertOrderedList")}>
          <span className="font-bold">۱≡</span>
        </Btn>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn label={t("editorUndo")} onClick={() => exec("undo")}>↶</Btn>
        <Btn label={t("editorRedo")} onClick={() => exec("redo")}>↷</Btn>
        <Btn label={t("editorClear")} onClick={() => exec("removeFormat")}>⌫a</Btn>
      </div>
      {/* ── the page ──────────────────────────────────────────────────── */}
      <div
        ref={ref}
        contentEditable
        dir="auto"
        role="textbox"
        aria-multiline="true"
        aria-label={t("editSummary")}
        className="rte min-h-64 px-4 py-3 leading-8 outline-none"
        style={{ fontSize: `${0.875 * fontScale}rem` }}
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
}
