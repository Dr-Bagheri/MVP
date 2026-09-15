"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons";
import { digits } from "@/lib/format";
import {
  subscribeDismiss,
  subscribeNotify,
  type NoticeKind,
  type PlatformNotice,
} from "@/lib/notify";

/**
 * THE TOAST STACK.
 *
 * ONE PLACE A MESSAGE APPEARS. Before this, a failure could reach the person
 * in any of four ways depending on which file it happened in: a red line
 * under a form, a red strip across a panel, a red paragraph pinned above a
 * list, or a bus notice drawn as a small pill beside the assistant. Four
 * looks for one meaning, and three of them were drawn by the surface that
 * failed — so whether you were told at all depended on whether that surface
 * was still on screen when the answer came back. A toast outlives its page.
 *
 * WHY IT LEFT THE ASSISTANT. The stack used to be rendered inside
 * `AssistantSidebar`, which made a message about the whole platform a
 * feature of one component: it inherited that component's corner, its
 * z-index and — the part that actually bit — its MOUNTING. The assistant
 * renders nothing for a signed-out visitor, so nothing on the sign-in,
 * reset or join pages could raise a toast at all. This is mounted in the
 * locale layout, above every route, signed in or not.
 *
 * WHERE IT SITS. Horizontally centred, near the TOP of the screen, rising
 * into place. Centre rather than a corner because these are now the only
 * report of a failure — the red line under the button is gone, and a notice
 * in the far corner of a wide screen is a notice nobody looking at the
 * button they just pressed will see. It rises rather than drops so the
 * motion points at the reading position instead of away from it.
 *
 * `top-4`, not the `top-20` it shipped at. At 80px it cleared the 62px top
 * bar by 18 and sat
 * INSIDE the page's own content column, reading as part of the screen; at 16
 * it is over the bar's middle — where the breadcrumb is, not the bell or the
 * clock — and reads as something laid on top of the app.
 *
 * ONE LINE. The reference card carried a title and a subtitle; the directive
 * is one line, so a notice is one string and the copy has to be a sentence
 * that stands alone. `line-clamp-2` is the seam for the few that come from a
 * server and cannot be shortened here — it bounds the card rather than
 * inviting two lines, and the full text stays in the bell.
 *
 * ── z-60: THE ONE RUNG ABOVE THE MODAL LAYER ─────────────────────────
 *
 * The ladder in `stacking.guard.test.ts` puts the modal layer at 50 and
 * everything else under it, on the reasoning that a dialog is the thing you
 * are answering. This sits ABOVE it, deliberately, and the reason is the one
 * already written into the aria-hidden defence below: an announcement is not
 * part of the page a modal excludes.
 *
 * It shipped at 40 and that was wrong in a way nothing on screen would have
 * confessed to. A refused save inside a dialog raises its toast behind that
 * dialog's own scrim — dimmed, under the panel, in the one situation where
 * the sentence is most needed. The two halves have to agree: a stack that
 * takes `aria-hidden` back off so a screen reader hears it, and then hides
 * the same card from everybody else, is worse than either choice made whole.
 *
 * A toast is safe up here in the way nothing else is: it is transient, and
 * its frame is `pointer-events-none`, so it cannot swallow a press meant for
 * the dialog underneath. Only the CARDS take pointer events back, because
 * the X has to be pressable — and they are 26rem of screen for four seconds,
 * not a layer over the app.
 *
 * ── REPEATS ──────────────────────────────────────────────────────────
 *
 * The same sentence twice is one card, said twice. `lib/notify` decides that
 * — it hands back the SAME id for a repeat inside its window — and the
 * subscribe below acts on it: replace the card in place, restart its clock,
 * show the count. See the note there for why one action is routinely four
 * writes and therefore four identical refusals.
 *
 * THE CARD IS `.toast-card`, a class, not a `rounded-xl border bg-surface`
 * written out here. The recipe is the same one R7 found seventy copies of,
 * and the seventy-first would be this file: a look that lives in a class
 * can be changed, and a look that lives in a className string can only be
 * re-litigated. Why this one surface is opaque and outlined while every
 * other floating layer is glass is written beside it in globals.css.
 *
 * ── IT PORTALS TO <body>, AND IT DEFENDS ITS OWN aria-hidden ───────────
 *
 * Every modal in the product is Radix, and Radix hides the rest of the page
 * from assistive technology while a dialog is open: `aria-hidden` sets
 * `aria-hidden="true"` on every CHILD OF <body> except the dialog's portal.
 * The app tree is one of those children, so a toast rendered in place is
 * inside the hidden subtree — visible on screen, and silent to a screen
 * reader, for exactly the sentences that matter most (a save was refused
 * while you were in the dialog that refused it).
 *
 * So: a host of its own, appended to <body>, and an observer that takes the
 * attribute back off whenever a dialog puts it on. The observer is not a
 * hack around a library — it is the one statement this file has to make
 * that the library cannot know: an ANNOUNCEMENT is not part of the page a
 * modal excludes. `aria-hidden` offers no opt-out; the alternative is a
 * failure that nobody sighted can see.
 */

const KIND_ICON: Record<NoticeKind, IconName> = {
  success: "checkCircle",
  info: "infoCircle",
  warn: "warn",
  error: "errorCircle",
};

/* Colour lives ON THE GLYPH, not on the card. The reference is a white card
   per row with one coloured mark; tinting the whole surface per kind gives
   four differently-coloured cards in one stack, which reads as four
   different components rather than four states of one. */
const KIND_TONE: Record<NoticeKind, string> = {
  success: "text-success",
  info: "text-info",
  warn: "text-warning",
  error: "text-danger",
};

/** how long a card stays. An error waits longer — it is the one you may have
    to read twice, and it is the one that usually needs a decision. */
const LIFETIME: Record<NoticeKind, number> = {
  success: 4000,
  info: 4000,
  warn: 6000,
  error: 7000,
};

/** at most this many cards at once; older ones fall off the top */
const MAX_STACK = 3;

export function Toaster() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const [toasts, setToasts] = useState<PlatformNotice[]>([]);
  /* the <body> child this renders into — null until mounted, because there
     is no document on the server and a portal needs one */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-toaster", "");
    document.body.appendChild(node);
    hostRef.current = node;
    setHost(node);

    /* see the header: Radix marks every body child but its own portal, and
       an announcement is not part of the page a modal excludes. Both
       attributes come off — `aria-hidden` is what silences the reader, and
       `data-aria-hidden` is the marker the library counts, left alone so its
       own bookkeeping still balances when the dialog closes. */
    const unhide = () => {
      if (node.getAttribute("aria-hidden") !== null) node.removeAttribute("aria-hidden");
    };
    const watcher = new MutationObserver(unhide);
    watcher.observe(node, { attributes: true, attributeFilter: ["aria-hidden"] });
    unhide();

    return () => {
      watcher.disconnect();
      node.remove();
      hostRef.current = null;
      setHost(null);
    };
  }, []);

  useEffect(() => {
    /* Timers are cleared on unmount rather than left to fire into a dead
       component: this mounts once per session, so a leak here is a leak for
       the whole session, and React logs a state-update-after-unmount for
       every one of them during a hot reload. */
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const drop = (id: string) => setToasts((prev) => prev.filter((item) => item.id !== id));

    /* The timer a card is currently living on, by id. A repeat has to be
       able to CANCEL the one already running: without this the second
       failure of a burst restarts the clock and the FIRST clock still fires
       four seconds later, taking the refreshed card down with it. */
    const perCard = new Map<string, ReturnType<typeof setTimeout>>();

    const offNotify = subscribeNotify((notice) => {
      setToasts((prev) => {
        /*
         * A REPEAT REPLACES ITS CARD, IN PLACE (2026-09-08).
         *
         * The bus reuses the id for the same sentence inside its window
         * (see `lib/notify`), so an id already on the stack is not a second
         * message — it is the same one, said again. Swapping the object
         * keeps the card exactly where it is and updates the count; pushing
         * would draw the words twice, and pushing-then-filtering would make
         * the card jump to the bottom of a stack the eye is already reading.
         */
        const at = prev.findIndex((item) => item.id === notice.id);
        if (at !== -1) {
          const next = [...prev];
          next[at] = notice;
          return next;
        }
        return [...prev, notice].slice(-MAX_STACK);
      });

      const running = perCard.get(notice.id);
      if (running !== undefined) {
        clearTimeout(running);
        timers.delete(running);
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        perCard.delete(notice.id);
        drop(notice.id);
      }, LIFETIME[notice.kind]);
      perCard.set(notice.id, timer);
      timers.add(timer);
    });
    const offDismiss = subscribeDismiss(drop);

    return () => {
      offNotify();
      offDismiss();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (host === null || toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div className="flex w-[min(92vw,26rem)] flex-col gap-2">
        {toasts.map((notice) => (
          <div
            key={notice.id}
            /* `alert` interrupts a screen reader and `status` waits for a
               pause. A failure is worth the interruption; a save that worked
               is not — the person is already moving on. */
            role={notice.kind === "error" || notice.kind === "warn" ? "alert" : "status"}
            className="toast-rise toast-card pointer-events-auto flex items-center gap-2.5 rounded-xl px-3 py-2.5"
          >
            {/* THE TONE RIDES ON THE ICON, not on a span wrapped round it
                (2026-09-08). The wrapper was the flex item, so what the
                card centred was a 24px LINE BOX with an 18px glyph sitting
                on its baseline — the row's own alignment was perfect and
                the mark inside it was 3.4px high. Handing the class to
                `Icon` makes the glyph itself the flex item, and then
                `items-center` centres the thing a person can actually see.
                `.icon` also carries `vertical-align: middle` now, which
                fixes the same fault everywhere it is NOT a flex child. */}
            <Icon
              name={KIND_ICON[notice.kind]}
              size="lg"
              className={`shrink-0 ${KIND_TONE[notice.kind]}`}
            />
            <p className="min-w-0 flex-1 text-start text-sm leading-5 text-fg line-clamp-2">
              {notice.text}
              {/* HOW MANY, when a burst collapsed into this one card. Four
                  refused writes shown as one sentence with nothing to say
                  they were four is a screen deciding the person did not need
                  to know how much failed. Digits follow the language, like
                  every other count in the product. */}
              {notice.count > 1 ? (
                <span className="ms-1.5 align-middle text-xs tabular-nums text-fg-subtle">
                  ×{digits(notice.count, locale)}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== notice.id))}
              /* `inline-flex items-center justify-center`: the button is a
                 padded box round a single glyph, and without it the glyph
                 sits on the button's baseline — the same 2.6px lift the mark
                 had, on the other end of the same card. */
              className="tap -me-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </div>,
    host,
  );
}
