# The front-end rulebook

**One shape per thing, written down once, enforced by something that runs.**

Started 2026-09-05 on the user's directive: *"make the front end solid and
always follow it until I say 'except this part' … give me the frontend shapes
we have right now as rules, one by one, and make them solid — we fix and make
them a rule one at a time."*

Everything below was **measured on production** (app.neurai.pt, signed in, the
user's own Chrome, 1920×855 with the assistant docked; computed styles, not
screenshots) and **counted in the source** (`web/src`, 2026-09-05). A number
here is a recorded observation with its conditions; the rule beside it is what
the platform does from now on. The root font is fluid — 16px at 1440, 17.5px at
1920 — so a measured 37px is the token's 34, and a measured 42 is the token's 38.

## How a rule becomes solid

| status | meaning |
|---|---|
| **PROPOSED** | written here from the measurement; the user has not ruled |
| **APPROVED** | the user said yes (or amended); the sweep may start |
| **FIXED** | every deviation swept, re-measured on production |
| **SOLID** | a guard in `npm test` fails when the rule is broken, verified red first |

A rule is worked **one at a time**, top to bottom in the order the user picks.
Exceptions are entries with reasons in the guard's allow-list — never a
loosened rule — and the user's "except this part" is what puts one there.

## The shapes, as they stand

### R1 · The shell — SOLID

- **Today:** rail 248 on the reading-start side with its labels and the
  «دستیار» button; top bar 62 with the trail, the clock and search on the
  rail's side and theme / locale / bell / chat / avatar on the other; the
  assistant docks as a 30% pane (min 320); the document never scrolls
  (`h-dvh` root — a page scrolls inside its own column).
- **Deviations:** none inside the shell. `/platform` (vendor console) and
  `/join/[code]` (guest door) render outside it by design; the console's
  controls are off-family (see R4/R20).
- **Enforced by:** `rhythm.guard` ("the shell scroll belongs to the shell"),
  `trail` coverage, nav-icon coverage.

### R2 · The page column — SOLID

- **Today:** `PageContainer` — `small` 1040 for reading/forms, `normal` 1240
  for lists and boards; padding 26 top / 28 inline / 40 bottom from
  `SCAFFOLD.page`; **no page-title block** — the breadcrumb names the page.
  Measured: 28.4 / 30.6 at 1920 (= 26 / 28).
- **Deviations:** none in the column itself. What varies is what pages put
  INSIDE it (R3, R7).
- **Enforced by:** `rhythm.guard` (named steps only, no copied literals,
  nobody re-implements the column).

### R3 · The toolbar and the primary action — PROPOSED · deviations measured

- **Today:** row 1 = section/view chips (`sectionTabClass` = `.btn btn-sm`,
  active = accent fill, groups split by a 1px divider); row 2 = scope chips
  (همه / بدون موضوع / +). `TwoPane` renders it for settings, management,
  profile, help; `ToolbarShell` for exactly ONE route (`/calls/[id]`).
  Everything else composes its own row.
- **Deviations (six dialects on nine pages):**
  - tasks / projects — two rows, no primary action (in-column add rows);
  - meetings — primary «+ جلسه جدید» as an OUTLINE `.btn` (42h) at the END of
    row 1;
  - workflows — primary «ساخت گردش‌کار» in its OWN ROW above; the two chips sit
    right-aligned in a second row;
  - agents — no chips; a sentence with a `btn-sm` «+ عامل تازه» after it;
  - chat — room chips, then TWO `btn-sm` buttons («افزودن اعضا», solid
    «اتاق تازه») at the end of the same row;
  - conversations — a text link «+ گفتگوی تازه» at the START, no button;
  - forms (profile, management/general) — a SOLID green `.btn-primary` in the
    card's footer; profile also has a full-width danger bar «خروج از حساب».
  Source: `role="tablist"` / `sectionTabClass` is built in 8 components
  outside `TwoPane`/`SectionTabs`.
- **Proposed rule:** every list surface renders ONE toolbar component:
  row 1 = tabs · divider · filters · **the page's primary action at the END,
  one shape** (`.btn btn-primary`, solid); row 2 = scope. A page never writes
  its own row; a page with no primary action renders none (never a text link
  in its place).
- **Solid =** `Toolbar` component + a guard: no `role="tablist"` and no
  `btn-primary` inside a page body outside the toolbar/footers.

### R4 · The control family — PARTIAL · a measured defect

- **Today:** `.btn` 38 (r11, 13/600) · `.btn-sm` 34 (r8, 12.5/600) ·
  `.btn-icon` 28×28 (r8) · variants primary / secondary / ghost / danger ·
  `.tap` gives 44 below md. Measured: btn-sm 37, btn-icon 31, btn 42 at 1920
  — the tokens, scaled. `control.guard` holds a worklist of the remaining
  hand-rolled controls.
- **THE DEFECT:** `.btn` carries `min-h-control`, and **min-height beats any
  smaller height written beside it**. Every control that tried to be smaller
  than 38 by writing `h-[…]` on a `.btn` renders at 38 (42 at 1920):
  - the panel chips (`chipClass`, `h-[34px]`) → measured **42**;
  - the panel tabs (`tabClass`, `h-[32px]` in a 42 bar) → measured **42**,
    filling the bar edge to edge;
  - `TOP_BUTTON h-[30px]`, `FOOTER_PRIMARY h-[40px]` → 42 at this width.
  The numbers measured off the reference on 2026-09-05 and asserted by
  `panelStyle.test.ts` never reached the screen: the test read the STRING.
  Plus: 26 raw `h-[Npx]` in components; the board's column names are 4
  unstyled 23px buttons.
- **Proposed rule:** **three control sizes, no fourth** — 38 / 34 / 28 — and
  a height written by hand on a control is a defect. Panel chips and top
  buttons = `btn-sm`; panel tabs = `btn-sm` inside a 42 bar with 4px padding
  (34 + 8 = 42 exactly); footers = `.btn`. The reference's 30/32/40/42 are
  rounded INTO the family, the same way its 9px chip corner rounds to the
  family's 8.
- **Solid =** `control.guard` gains: a className that contains `btn` may not
  contain `h-[`/`min-h-[`; `panelStyle.test` asserts the family classes;
  re-measured on production after deploy.
- **The user's call:** one family (3 sizes) vs. reference-exact sizes (adds
  chip 34/9, tab 32, top 30, footer 42/40 — seven sizes). Recommendation: one
  family; the reference's own toolbar buttons are 38 and its dialog footer is
  the outlier.

### R5 · Fields — PROPOSED · two label styles

- **Today:** `.input` 40 (44 below md), r11, the recessed `--field` ground,
  13px; `.input-sm` 34; Select / DateField / TimeField are the platform's own
  (Radix) — `select.guard`. Measured: 44 (= 40) everywhere, r11, field ground.
- **Deviations:** two LABEL styles — page forms (profile, management/general)
  label at 13/400 in `fg`; dialogs and panels label at 11.5/600 in
  `fg-subtle` (`FIELD_LABEL`). Same product, two forms.
- **Proposed rule:** one `Field` (label 11.5/600 subtle above the control, the
  reference's) in pages and dialogs alike; helper text 11 subtle under it;
  error under the field, never at the top.
- **Solid =** `ui.field` renders the label; a guard forbids a bare `<label>`
  around an `.input` outside `ui/`.

### R6 · The type scale — PROPOSED · 212 raw sizes

- **Today (`SCAFFOLD.fontSize`, all rem):** page 16 · section 15 · pane/card
  title 14/700 · menu 13.5 · body 13 · detail 12.5 · group-label 11.
  Tailwind's `text-sm`/`text-xs` are re-pointed at the scale. The root is
  fluid (`clamp(14px, 11.5px + 0.3125vw, 20px)`).
- **Deviations:**
  - **212 raw px sizes in 47 files** — `text-[11px]` ×128, `text-[10px]` ×75,
    9/12/13/15/17 the rest. A px size does not scale with the root, so at 1920
    the tokens grow 9% and these do not: the page's proportions change with
    the window.
  - row and card TITLES sit at 16 (17.5 measured) where the scale says card
    title 14/700: users table names 17.5/500, meeting rows 17.5/400, task
    cards 17.5/400, workflow hero titles 17.5/600.
  - the meeting page's section headings are 13/600 — body size.
- **Proposed rule:** only the scale's classes; a row/card title is
  `text-pane-title font-bold`; a section heading is `text-section`.
- **Solid =** guard: no `text-[Npx]` in components outside an allow-list with
  reasons (badge digits, HUD-like marks); a render test on DataTable/tile
  rows asserts the title class.

### R7 · Surfaces — PROPOSED · two card radii, 70 hand-rolled recipes

- **Today:** `.card` (rounded-2xl = 18, border, surface, p-4, `shadow-card`),
  `.tile` (**20**, `shadow-island`) for dashboard tiles, `.tile-row` (16, row
  shadow) for list lines, `.table-cards` rows (16), kanban column
  (`rounded-2xl border bg-surface p-2.5 shadow-card`, hand-rolled), task card
  (`rounded-xl border`, hand-rolled).
- **Deviations:**
  - **two card radii**: `.tile` is 20 while the token (`radius.modal`) moved to
    18 — meeting-page cards measured 20, settings cards 18;
  - **70 inline card recipes** (`rounded-(xl|2xl) … border … bg-surface`) in
    15+ files vs 15 `.card` and 47 `.tile` uses;
  - **shadow by accident**: workflow tiles, the profile form card and agent
    cards carry NO shadow; settings cards, board columns and rows do.
- **Proposed rule:** three surfaces and nothing else — **card** 18 + ambient
  shadow, **row** 16 + row shadow, **column** 18 + ambient shadow — each a
  class; an inline recipe is a defect. `.tile` takes the token.
- **Solid =** guard on className strings combining a radius, a border and a
  surface ground; `.tile`'s radius asserted equal to `radius.modal`.

### R8 · Dialogs and panels — PROPOSED · a measured defect

- **Today:** `Overlay` (sm/md/lg = max-w-md/lg/3xl, `rounded-2xl`,
  `shadow-island`, title 15/700 + subtitle 12); the task detail panel
  1120×760 with a 283 rail, title 17/700, body headings 11.5/700, tab bar 42.
- **THE DEFECT:** `ui/dialog.tsx`'s `DialogContent` carries **`sm:rounded-lg`**,
  which beats `rounded-2xl` from 640px up — **every Overlay dialog renders at
  radius 12, not 18** (new-task dialog measured 12; the detail panel, which
  does not pass through it, measured 18). The markup reads as satisfied.
- **Proposed rule:** one dialog corner (18), one header (title 15/700,
  subtitle 12 subtle, close at the END), one footer (cancel `.btn` +
  primary `.btn-primary`, right-aligned in LTR terms = END).
- **Solid =** remove the base radius from `DialogContent`; a render test
  asserts Overlay's element carries no `sm:rounded-*` and does carry the
  token class; `SCAFFOLD.radius.modal` stays the one number.

### R9 · Tables — SOLID (one open item, see R6)

- **Today:** `DataTable` is the one table — rows are `.table-cards` (16,
  border painted on the cells with logical corners), head `text-group-label`
  600 muted, **ten rows then the pager**, skeleton rows while loading, a named
  empty state. Measured: row 72, head 12 (= 11), cell radius 16.
- **Deviations:** row names at 16 (R6).
- **Enforced by:** `Pagination.test`, `loading.guard`, DataTable tests.

### R10 · Menus — SOLID

- **Today:** `KebabMenu` / `ContextMenu` / `AvatarMenu` on Radix — panel r12,
  surface, 4px padding, items 38h at 12.5px with a 13px inset, icon gutter
  always spent, red items last, opens on pointerdown. Measured: 236 wide,
  r12, item 38 / 12.58px.
- **Enforced by:** `popover.guard`, `select.guard`, `rowActions.menu.test`.

### R11 · Feedback and consent — SOLID

- Destructive controls confirm in the one `ConfirmDialog` (`confirm.guard`);
  no native `alert/prompt/confirm` (`nativeDialog.guard`); a save/delete/change
  reports through `notify` — never a timed toast, the one exception being
  clipboard acks (`notifyRule.guard`); a failed run is an annotation, never a
  bubble (thread tests).

### R12 · Loading and empty — PARTIAL

- **Today:** `Skeleton` / `SkeletonLines` / `SkeletonCards`, `DataTable
  loading`, three-state identity (loading ≠ nobody), «—» never «0»;
  `loading.guard` holds a worklist.
- **Deviations:** empty states are ad-hoc sentences in ad-hoc places (chat:
  centred 13px muted inside the box; board: the dashed add-card row; lists:
  DataTable's own). Each names its nothing — good — but none share a shape.
- **Proposed rule:** one `Empty` shape (sentence at 13 muted, optional
  action as `btn-sm`, centred in the surface that would hold the rows).

### R13 · Icons — SOLID

- One registry (`components/icons.tsx`), 16px inside controls, nav icons
  derived from the nav; `icons.guard`.

### R14 · Colour — SOLID at the tokens, PROPOSED at the primary

- **Today:** tokens only (bg / surface / surface-2 / field / border /
  border-strong / fg / fg-muted / fg-subtle / accent / on-accent / primary /
  on-primary / status ×4 with 12% chips), `verify-pairs.mjs` holds every
  contrast floor, dark-first, both themes derived together.
- **Deviation:** the "main thing to press" comes in three coats — solid green
  (`btn-primary` in forms, «اتاق تازه»), outline green («جلسه جدید»,
  «ساخت گردش‌کار»), and the accent chip fill of an active tab. One primary
  coat (with R3).

### R15 · Direction — SOLID

- Logical properties by default; physical ONLY where the thing is pinned or
  pointer-anchored (composer row `dir="ltr"`, sign-in eye, context-menu
  anchor); `DirectionProvider` wraps the tree. `direction.guard`,
  `tile-direction.guard`, the composer's side test.

### R16 · Motion — PROSE

- Controls 150ms; a message arrives with a 6px rise over 420ms; dialogs zoom
  from 98% over 150ms; `prefers-reduced-motion` stops all of it. No guard;
  `units.guard` covers the units.

### R17 · Boards — PROPOSED

- **Today:** column 300 wide, r18 + ambient shadow, 10px inset, 70vh floor;
  cards hand-rolled (`rounded-xl border`, 77h); dashed «افزودن کارت» row;
  header = name (an unstyled 23px button that renames in place) · tone dot ·
  count · `btn-icon` acts.
- **Proposed rule:** column = the R7 column surface; card = the R7 row
  surface; header controls = `btn-ghost btn-sm`; the add row = `btn-sm`
  dashed, full width. Same on tasks and projects (already one component).

### R18 · Detail surfaces — PROPOSED · four headers

- **Today:** a thing with an address is a PAGE (project, meeting, agent,
  workflow); a task is a modal (`?task=`). Four page headers, four shapes:
  workflow = 88px icon tile + title 17.5 + on/off pill; agent = avatar + name
  + «پرسیدن» button; meeting = stage stepper; project = the task panel's
  anatomy.
- **Proposed rule:** one detail header — identity mark · title 17/700 ·
  one-line summary · acts at the END as `btn-sm` — above a body + 283 rail
  (the task panel's anatomy, already measured).

### R19 · Composers — PROPOSED · two

- **Today:** the room composer (two fixed lines, `dir="ltr"` row, @ / mic /
  emoji at the left, outline send at the right) and the assistant composer
  (growing textarea, «+», mic, send). Two composers, two shapes, one mic hook.
- **Proposed rule:** one `Composer` with slots; the mic tone from `micTone`.

### R20 · Surfaces outside the shell — PROPOSED

- `/platform` (vendor) and `/join/[code]` (guest) own their documents by
  design; their CONTROLS are still the family's. Today the console uses pill
  chips and its own header buttons.

## Bugs found while measuring (not rules — fixes)

1. `/fa/settings/<unknown-slug>` renders the GENERAL pane under a breadcrumb
   that reads the raw key `settings.section.<slug>` — an unknown section must
   404 or land on `/settings`, and the trail must never print a key.
2. `.btn` min-height (R4) and the dialog radius (R8) — real, measured,
   invisible in the source.

## Order proposed

R4 → R8 → R7 → R6 → R3 (+R14's primary coat) → R5 → R17 → R18 → R19 →
R12 → R20 → R16. The first two are pure defects with a one-file cause; the
next three are the sweeps that make pages stop looking hand-made; the rest
are compositions the user should see before they are drawn.
