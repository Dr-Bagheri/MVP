"use client";

/**
 * The table-row action kit (user directive, 2026-08-24 cleanup): every
 * table stops spelling its actions as a row of text links. The pattern is
 * ONE component set so no table can drift into its own dialect:
 *
 *  - `IconAction` — a bare icon button (pencil-on-hover rename, trash).
 *  - `KebabMenu`  — the ⋯ dropdown holding the secondary actions.
 *  - `ConfirmDialog` — the are-you-sure popup that replaced typed reasons
 *    on product deletes (the LEDGER still receives a reason: a fixed,
 *    platform-authored sentence — the popup's confirm IS the consent).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "@/components/icons";

export function IconAction({
  label,
  onClick,
  children,
  danger = false,
  disabled = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`tap inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        danger
          ? "text-danger/70 hover:bg-danger/10 hover:text-danger"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      } disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export interface KebabItem {
  key: string;
  label: string;
  /**
   * REQUIRED (user directive, 2026-08-26: "all items in kebab menus in the
   * theme must have an icon").
   *
   * Not optional-with-a-convention: a menu is a column of icons before it
   * is a column of words, and one item without one leaves a hole in that
   * column that reads as a rendering fault. Making it required means a new
   * menu item cannot ship iconless — the compiler asks for it at the only
   * moment anyone is thinking about that item.
   *
   * `null` is the deliberate escape hatch for the rare row that is a
   * VALUE, not an action (a size in the size flyout, a language in an
   * export list) — spelled out loud so it reads as a decision rather than
   * as a forgotten field.
   */
  icon: ReactNode | null;
  onSelect?: () => void;
  /**
   * A destructive item. The menu SORTS these to the bottom and rules a
   * line above them (see `orderItems`) — the theme's other half of this
   * directive: "the red one stays together too". Nobody has to remember to
   * put delete last, and no menu can end up with a red row in the middle
   * where a mis-click lands on it.
   */
  danger?: boolean;
  disabled?: boolean;
  /** a toggle stays IN the menu when pressed (redact, view modes) */
  keepOpen?: boolean;
  /** a SUB-menu (2026-08-25 redesign, the Supabase reference): a FLYOUT
      panel that steps a little OUT of the parent menu — overlapping its
      edge — instead of indenting inside it. This is the theme's default
      for every kebab everywhere; grouping into subs is also how a long
      menu stays scroll-free (the menu itself never scrolls). */
  sub?: KebabItem[];
}

const MENU_W = 176; // matches min-w-44
const ITEM_H = 34;  // one row's height — the no-scroll placement math
const RULE_H = 9;   // the separator above the danger group

/**
 * THE DANGER GROUP (user directive, 2026-08-26: "the red one stays together
 * too, in the theme").
 *
 * Destructive items sort to the END, in the order the caller listed them,
 * with a rule drawn above the group. Doing it here rather than at each call
 * site means it is true of every menu in the product, including the ones
 * nobody has written yet — and a red row can never end up in the middle of
 * a list where the pointer passes over it on the way somewhere else.
 *
 * Stable within each half: `filter` preserves order, so a caller's chosen
 * sequence survives inside the safe group and inside the danger group.
 */
function orderItems(items: KebabItem[]): { safe: KebabItem[]; danger: KebabItem[] } {
  return {
    safe: items.filter((item) => !item.danger),
    danger: items.filter((item) => item.danger),
  };
}

/** the rendered height of a menu, for the no-scroll placement math */
function menuHeight(items: KebabItem[]): number {
  const { danger } = orderItems(items);
  return items.length * ITEM_H + 10 + (danger.length > 0 && danger.length < items.length ? RULE_H : 0);
}

/** the two groups, with the theme's rule between them */
function MenuBody({
  items, expanded, setExpanded, close,
}: {
  items: KebabItem[];
  expanded: string | null;
  setExpanded: (key: string | null, anchor?: DOMRect) => void;
  close: () => void;
}) {
  const { safe, danger } = orderItems(items);
  return (
    <>
      {safe.map((item) => (
        <MenuEntry
          key={item.key} item={item} expanded={expanded}
          setExpanded={setExpanded} close={close}
        />
      ))}
      {danger.length > 0 && safe.length > 0 ? (
        <hr className="my-1 border-border" />
      ) : null}
      {danger.map((item) => (
        <MenuEntry
          key={item.key} item={item} expanded={expanded}
          setExpanded={setExpanded} close={close}
        />
      ))}
    </>
  );
}

function MenuEntry({
  item, expanded, setExpanded, close,
}: {
  item: KebabItem;
  expanded: string | null;
  setExpanded: (key: string | null, anchor?: DOMRect) => void;
  close: () => void;
}) {
  const isOpen = expanded === item.key;
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup={item.sub ? "menu" : undefined}
      aria-expanded={item.sub ? isOpen : undefined}
      disabled={item.disabled}
      onClick={(e) => {
        if (item.sub) {
          return setExpanded(
            isOpen ? null : item.key,
            (e.currentTarget as HTMLElement).getBoundingClientRect(),
          );
        }
        item.onSelect?.();
        if (!item.keepOpen) close();
      }}
      className={`flex w-full items-center gap-2.5 py-2 pe-3 ps-3 text-start text-xs transition-colors ${
        item.danger
          ? "text-danger hover:bg-danger/10"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      } ${isOpen ? "bg-surface-2 text-fg" : ""} disabled:pointer-events-none disabled:opacity-40`}
    >
      {/* the icon GUTTER is always spent, even by an item that declined one
          (a value row, `icon: null`) — otherwise its label sits four pixels
          left of every other and the column looks broken */}
      <span className="grid h-4 w-4 shrink-0 place-items-center opacity-80">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.sub ? (
        <span aria-hidden className="inline-block text-[10px] rtl:-scale-x-100">▸</span>
      ) : null}
    </button>
  );
}

export function KebabMenu({
  label,
  items,
  trigger,
  triggerClassName,
}: {
  label: string;
  items: KebabItem[];
  /** replaces the ⋯ glyph (e.g. the player's speed readout «۱.۵×») */
  trigger?: ReactNode;
  /** shapes the trigger BOX — the recorder's transport wants a round 40px
      button in a row of round buttons, not the 28px square every table
      row wants. Overrides the default sizing entirely. */
  triggerClassName?: string;
}) {
  const [expanded, setExpandedKey] = useState<string | null>(null);
  /** where the open flyout sits — computed from its parent item's rect */
  const [flyoutAt, setFlyoutAt] = useState<{ top: number; left: number } | null>(null);
  /** null = closed; otherwise the VIEWPORT position the portal renders at.
      The menu portals to <body> (user report, 2026-08-24: opening it inside
      a table's overflow container clipped the menu and scrolled the table —
      "the menu should be always on top"). position:fixed + a portal escapes
      every ancestor overflow; any scroll or resize simply closes it. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  /**
   * NO-SCROLL PLACEMENT (user directive, 2026-08-25): the menu always opens
   * COMPLETELY — below the trigger when it fits, flipped above it when it
   * doesn't, and it never grows a scrollbar of its own. When a menu wants
   * more rows than a viewport holds, the caller groups them into `sub`
   * flyouts — that is the theme's answer, not scrolling.
   */
  function toggle() {
    if (at) return closeAll();
    setExpandedKey(null);
    setFlyoutAt(null);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === "rtl";
    const left = rtl ? rect.left : rect.right - MENU_W;
    const height = menuHeight(items);
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - 4 - height);
    setAt({
      top,
      left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)),
    });
  }

  function closeAll() {
    setAt(null);
    setExpandedKey(null);
    setFlyoutAt(null);
  }

  /**
   * The flyout steps OUT of the parent menu — outward in the reading
   * direction, overlapping the parent's edge by ~12px (the Supabase-style
   * reference the user pointed at) — and flips to the other side when the
   * viewport ends. Its top clamps so it, too, opens completely.
   */
  function setExpanded(key: string | null, anchor?: DOMRect) {
    setExpandedKey(key);
    if (!key || !anchor || !at) return setFlyoutAt(null);
    const item = items.find((i) => i.key === key);
    const height = (item?.sub?.length ?? 0) * ITEM_H + 10;
    const rtl = document.documentElement.dir === "rtl";
    const outward = rtl ? at.left - MENU_W + 12 : at.left + MENU_W - 12;
    const fits = outward >= 8 && outward + MENU_W <= window.innerWidth - 8;
    const flipped = rtl ? at.left + MENU_W - 12 : at.left - MENU_W + 12;
    setFlyoutAt({
      top: Math.max(8, Math.min(anchor.top - 5, window.innerHeight - height - 8)),
      left: fits ? outward : Math.max(8, Math.min(flipped, window.innerWidth - MENU_W - 8)),
    });
  }

  useEffect(() => {
    if (!at) return;
    const close = () => closeAll();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target)
        && !menuRef.current?.contains(target)
        && !flyoutRef.current?.contains(target)
      ) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeAll is stable in spirit
  }, [at]);

  const openSub = expanded ? items.find((i) => i.key === expanded)?.sub : undefined;

  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <IconAction
        label={label}
        onClick={toggle}
        className={triggerClassName ?? (trigger ? "w-auto px-1.5" : "")}
      >
        {trigger ?? <IconDots />}
      </IconAction>
      {at
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", top: at.top, left: at.left, minWidth: MENU_W }}
              className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuBody
                items={items}
                expanded={expanded}
                setExpanded={setExpanded}
                close={closeAll}
              />
            </div>,
            document.body,
          )
        : null}
      {at && openSub && flyoutAt
        ? createPortal(
            <div
              ref={flyoutRef}
              role="menu"
              style={{ position: "fixed", top: flyoutAt.top, left: flyoutAt.left, minWidth: MENU_W }}
              className="z-[51] rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuBody
                items={openSub}
                expanded={null}
                setExpanded={() => undefined}
                close={closeAll}
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/**
 * A RIGHT-CLICK menu (user directive, 2026-08-25): table rows stopped
 * showing a ⋯ trigger — the same items open as a context menu at the
 * pointer instead. Same panel, same discipline (portal, full open with a
 * flip, outside/Escape/scroll closes). The caller owns the open state:
 * `onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX,
 * y: e.clientY }); }}`.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: KebabItem[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const height = menuHeight(items);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const left = rtl ? at.x - MENU_W : at.x;
  const top = at.y + height <= window.innerHeight - 8
    ? at.y
    : Math.max(8, at.y - height);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: "fixed",
        top,
        left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)),
        minWidth: MENU_W,
      }}
      className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <MenuBody
        items={items}
        expanded={null}
        setExpanded={() => undefined}
        close={onClose}
      />
    </div>,
    document.body,
  );
}

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** an option-level DELETE (2026-08-25, the version picker): a small ✕ at
      the option's end — pressing it fires this instead of selecting */
  onRemove?: () => void;
}

/**
 * THE platform dropdown (user directive, 2026-08-25): every select opens a
 * panel styled EXACTLY like the kebab menu — same border, surface, shadow,
 * item hover — instead of the browser's native option list. A theme
 * STRUCTURE item beside KebabMenu: new dropdowns use this; remaining native
 * selects (AuditLogs, OrgFields, profile — their tests grip the native
 * element) swap as they are next touched.
 *
 * Same discipline as the kebab: portal to <body>, fixed position, opens
 * COMPLETELY (flips up when the viewport ends, never scrolls internally),
 * closes on outside click / Escape / scroll / resize.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  disabled = false,
  icon,
  panelFooter,
  panelHeading,
  variant = "input",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  ariaLabel: string;
  /** sizing/spacing for the TRIGGER (defaults to the input look) */
  className?: string;
  disabled?: boolean;
  /** a leading glyph on the trigger — what KIND of thing this picks (the
      reference: Meet's device pills, a mic before the mic's name) */
  icon?: ReactNode;
  /**
   * Rendered at the FOOT of the open panel, under a hairline — the live
   * half of a picker (the mic's level meter, the speaker's test-sound
   * row). It mounts only while the panel is open, so a meter here opens
   * its device on open and releases it on close.
   */
  panelFooter?: ReactNode;
  /** small accent heading at the panel's top, naming what is being picked —
      the tile trigger shows no field name, so the open panel says it (the
      call-bar reference: «Microphone» over the device list) */
  panelHeading?: string;
  /**
   * "input" (default) = the form-field face. "tile" = the CALL-BAR face:
   * a big rounded button holding only the glyph, the chosen value
   * captioned underneath. "round" = the TRANSPORT face (2026-08-26): a
   * circular icon button that sits in a row of circular controls, its
   * value spoken only by the accessible name and the panel's own check.
   * The panel is the same kebab-family menu in every case.
   */
  variant?: "input" | "tile" | "round";
}) {
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value);

  /**
   * HOVER-OPEN, tile face only (user directive, 2026-08-26: "come out
   * without click, just by mouse hover, and disappear when it passes").
   * The grace timer lets the pointer cross the gap between button and
   * panel; a held pointer (dragging the sensitivity slider past the
   * panel's edge) never closes it. The input face keeps click-only —
   * a form select that opens under a passing pointer is hostile.
   */
  const hoverable = variant !== "input";
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpenedAt = useRef(0);
  const panelHeld = useRef(false);
  function cancelScheduledClose() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    if (panelHeld.current) return;
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => setAt(null), 160);
  }
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  function toggle() {
    if (at) return setAt(null);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, variant === "input" ? 160 : 240);
    const rtl = document.documentElement.dir === "rtl";
    const left = rtl ? rect.right - width : rect.left;
    const height = options.length * ITEM_H + 10;
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - 4 - height);
    setAt({
      top,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      width,
    });
  }

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const chevron = (size: number) => (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-fg-muted transition-transform duration-150 ${
        at !== null ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );

  return (
    <>
      {variant === "round" ? (
        /* the TRANSPORT face: one circle among circles. It carries no
           caption — the row is a transport, not a form, and the chosen
           device is read from the panel's check (and from the accessible
           name, which names value as well as field) */
        <button
          type="button"
          ref={rootRef}
          aria-label={current ? `${ariaLabel}: ${current.label}` : ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={at !== null}
          disabled={disabled}
          onMouseEnter={hoverable && !disabled ? () => {
            cancelScheduledClose();
            if (!at) {
              hoverOpenedAt.current = Date.now();
              toggle();
            }
          } : undefined}
          onMouseLeave={hoverable ? scheduleClose : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (at && Date.now() - hoverOpenedAt.current < 400) return;
            toggle();
          }}
          className={`tap grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            at !== null
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg"
          } ${className}`}
        >
          {icon}
        </button>
      ) : variant === "tile" ? (
        /* the CALL-BAR face: one big glyph filling the button — the arrow
           left (user directive, 2026-08-26) with hover doing its job. The
           sizes are clamp()ed to the viewport so the row breathes on a
           wide screen and tightens on a small one; the chosen value stays
           captioned below, never crowding the button. */
        <div className="flex w-[clamp(3.5rem,5.5vw,4.5rem)] flex-col items-center gap-1.5">
          <button
            type="button"
            ref={rootRef}
            aria-label={current ? `${ariaLabel}: ${current.label}` : ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={at !== null}
            disabled={disabled}
            onMouseEnter={hoverable && !disabled ? () => {
              cancelScheduledClose();
              if (!at) {
                hoverOpenedAt.current = Date.now();
                toggle();
              }
            } : undefined}
            onMouseLeave={hoverable ? scheduleClose : undefined}
            onClick={(e) => {
              e.stopPropagation();
              /* a touch tap fires mouseenter+click together — the click
                 must not instantly close what its own hover just opened */
              if (at && Date.now() - hoverOpenedAt.current < 400) return;
              toggle();
            }}
            className={`tap grid h-[clamp(2.75rem,4.2vw,3.5rem)] w-full place-items-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              at !== null
                ? "border-accent bg-accent-soft ring-1 ring-accent/30"
                : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
            }`}
          >
            <span className="grid place-items-center text-fg [&_svg]:h-[clamp(1.05rem,1.7vw,1.35rem)] [&_svg]:w-[clamp(1.05rem,1.7vw,1.35rem)]">
              {icon}
            </span>
          </button>
          <span
            className="w-full truncate text-center text-[11px] leading-4 text-fg-muted"
            title={current?.label}
          >
            {current?.label ?? ""}
          </span>
        </div>
      ) : (
      <button
        type="button"
        ref={rootRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        /* the trigger is the theme's ONE dropdown face (user directive,
           2026-08-26: "more professional and clean"): the input base plus a
           real chevron that turns when open, a hover border, and the accent
           ring while the list is up — so an open dropdown is findable after
           the eye wandered to its panel */
        className={`input flex items-center justify-between gap-2 text-start transition-colors hover:border-border-strong ${
          at !== null ? "border-accent ring-1 ring-accent/30" : ""
        } ${className}`}
      >
        {icon ? <span className="shrink-0 text-fg-muted">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ""}</span>
        {chevron(14)}
      </button>
      )}
      {at
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={ariaLabel}
              style={{ position: "fixed", top: at.top, left: at.left, minWidth: at.width }}
              className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={hoverable ? cancelScheduledClose : undefined}
              onMouseLeave={hoverable ? scheduleClose : undefined}
              onPointerDown={hoverable ? () => {
                panelHeld.current = true;
                window.addEventListener("pointerup", () => { panelHeld.current = false; }, { once: true });
              } : undefined}
            >
              {panelHeading ? (
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-accent">
                  {panelHeading}
                </p>
              ) : null}
              {options.map((o) => (
                <span key={o.value} className="group/opt flex items-center">
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    disabled={o.disabled}
                    onClick={() => {
                      setAt(null);
                      if (o.value !== value) onChange(o.value);
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-2 ps-2.5 text-start text-xs transition-colors ${
                      o.onRemove ? "pe-1" : "pe-3"
                    } ${
                      o.value === value
                        ? "bg-surface-2 font-semibold text-fg"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                    } disabled:pointer-events-none disabled:opacity-40`}
                  >
                    {/* the check LEADS and its gutter is always spent —
                        one scannable column of marks, labels aligned */}
                    <span aria-hidden className="grid w-4 shrink-0 place-items-center text-[10px] text-accent">
                      {o.value === value ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                  {o.onRemove ? (
                    <button
                      type="button"
                      aria-label={`✕ ${o.label}`}
                      className="me-1.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] text-fg-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/opt:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAt(null);
                        o.onRemove?.();
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              ))}
              {panelFooter ? (
                <div className="mt-1 border-t border-border px-2.5 pb-1.5 pt-2">
                  {panelFooter}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  confirmDisabled = false,
  wide = false,
  alt,
  hideCancel = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** prose, or a whole form when the confirmation needs an ANSWER (merge
      asks which person this one becomes) — a dialog that only ever holds a
      sentence forces the second dialog nobody styles */
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** the answer is missing — the button is there and says why by staying off */
  confirmDisabled?: boolean;
  /** a body holding a LIST needs the room; prose does not */
  wide?: boolean;
  /**
   * A SECOND real action beside confirm — the recorder's stop asks
   * "save it, or delete it?", and both are answers, not dismissals.
   *
   * Deliberately its own slot rather than repurposing cancel: cancel also
   * fires on Escape and on a backdrop click, so an action parked there
   * would run every time someone dismissed the dialog.
   */
  alt?: { label: string; onSelect: () => void; danger?: boolean };
  /**
   * Drops the cancel BUTTON (user directive, 2026-08-26: the recorder's
   * stop dialog was three fat buttons wide and stopped looking like the
   * theme's two-button box). Dismissal does not go away with it: Escape
   * and the backdrop still call `onCancel`, and a corner ✕ appears so the
   * way out stays visible — a destructive dialog with no visible exit is
   * how a mis-press becomes a decision.
   */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-2xl border border-border bg-surface p-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-base font-semibold text-fg">{title}</h2>
          {hideCancel ? (
            <button
              type="button"
              aria-label={cancelLabel}
              title={cancelLabel}
              className="tap -me-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              onClick={onCancel}
            >
              ✕
            </button>
          ) : null}
        </div>
        {body ? (
          typeof body === "string"
            ? <p className="mt-2 text-sm leading-6 text-fg-muted">{body}</p>
            : <div className="mt-3">{body}</div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          {hideCancel ? null : (
            <button type="button" className="btn-secondary h-9 min-h-0 px-4 text-sm" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          {alt ? (
            <button
              type="button"
              className={`${alt.danger ? "btn-danger" : "btn-secondary"} h-9 min-h-0 px-4 text-sm`}
              disabled={busy}
              onClick={alt.onSelect}
            >
              {alt.label}
            </button>
          ) : null}
          <button
            type="button"
            className={`${danger ? "btn-danger" : "btn-primary"} h-9 min-h-0 px-4 text-sm`}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
