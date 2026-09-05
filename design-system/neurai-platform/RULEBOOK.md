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

## Rulings on record

**2026-09-05 (the user, after reading the first draft):**

1. **The template is the tasks page and the meetings page** — for pages,
   buttons, dropdowns, tables, margins, spacing, dividers, everything. Where a
   rule below needs a reference shape, it is the one those two pages use.
2. **A create button sits in the same row as the first sub-menu** (row 1 of the
   toolbar), the way tasks and meetings do. Every page.
3. **The two kanban boards (tasks, projects) are the same board.** One
   component; today they differ.
4. **Same table or same button on two pages = same size.** Dividers placed the
   same way, text the same style and size.
5. **The Persian font must read well and render sharp** — a type decision to be
   made under R6, with candidates shown, not slipped in.
6. **Every rule applies to every page.** The only two surfaces allowed a
   different STRUCTURE are the AI assistant and the dashboard — same theme,
   different anatomy. (`/platform` and `/join` stay outside the shell as
   before; their controls still follow the family.)
7. **R4 = option (a): one control family, three sizes.**

**2026-09-05, later (eleven screenshots):**

8. **No explanations under titles and headers.** "Just the name — and
   sometimes, if it's too important, one sentence." → R21.
9. **A thing in a list opens as a POP-UP over the list, not as a page.**
   Projects first ("this problem is systematic") → R18.
10. **Projects carry most of the problems**: the board must be the tasks
    board, the detail must be the task detail's pop-up.

**2026-09-05, evening (fifteen items, twelve screenshots):**

11. **Sections in every pop-up are DIVIDED** — "add divider between different
    sections in all pop-up windows; they all seem connected; even if they
    don't have information in them, put empty space for the parts that need
    it, give the structure." → R8 (dialogs) and R18 (the detail's body and
    rail), one rhythm in `panelStyle`.
12. **The main menu opens COMPACT by default, in both locales**, and never
    flashes open on a navigation; in Persian the expand chevron is `<`. → R1.
13. **The assistant strip is part of the skeleton** — present on the first
    frame of every reload, never after the identity read. → R1.
14. **Row two's gap to its content is the board's 12** (`FILTER_ROW_GAP`); the
    audit log's table drops its header row; member privileges get a row two
    (اعضا | مدیران); projects' scope chips move UP to row one, before «مهلت
    امروز» (a ruling for that page — row two stays the rule elsewhere). → R3.
15. **A row inside a card is a row, not a box** (assistant settings). → R7.
16. **The mic hotkey is PUSH-TO-TALK**: hold to listen, release to stop, one
    microphone per key.

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
  `trail` coverage, nav-icon coverage, `IconRail.test` (the width on the
  first frame), `AssistantSidebar.test` (the strip before the network).
- **2026-09-05 (rulings 12–13):** the rail opens COMPACT by default in both
  locales and reads its width from a store (`lib/railCompact.ts`) on the
  first render of every mount — it remounts per page, and the `useState` +
  effect version flashed open and slid shut on every navigation. Expand
  points at the content (inline-end: `>` en / `<` fa), collapse at the wall.
  The assistant strip renders for an unanswered identity (`member ===
  undefined`) and leaves only on "not a member"; its width is published in a
  layout effect, so the page is centred between the two menus from the first
  frame rather than stepping sideways when `/api/me` lands.

### R2 · The page column — SOLID

- **Today:** `PageContainer` — `small` 1040 for reading/forms, `normal` 1240
  for lists and boards; padding 26 top / 28 inline / 40 bottom from
  `SCAFFOLD.page`; **no page-title block** — the breadcrumb names the page.
  Measured: 28.4 / 30.6 at 1920 (= 26 / 28).
- **Deviations:** none in the column itself. What varies is what pages put
  INSIDE it (R3, R7).
- **Enforced by:** `rhythm.guard` (named steps only, no copied literals,
  nobody re-implements the column).

### R3 · The toolbar and the primary action — FIXED for the create button (2026-09-05), the one-component half PROPOSED

- **Row two = filter chips (SOLID, user ruling 2026-09-05: "the style for the
  second sub menu of the top is different — fill with icon like in meetings;
  make it a rule, add it in the theme and apply it for all the platform").**
  Row one is the plain tab (`sectionTabClass`, accent-filled when active); the
  row under it is the FILTER CHIP (`filterChipClass` / `FilterChips` in
  `sectionTabs.tsx`): outlined, an ICON at the start, the label, a count
  where one exists, soft-filled in the accent when active — the chip the
  tasks and meetings folder strips drew first. Applied to security
  (all | online | offline with counts), the audit log (a glyph per source)
  and the workflow shelf's kinds; tasks, meetings and projects already wore
  it. A second row that wears the row-one tab is a defect.
  **2026-09-05, evening:** the gap under row two is the board's own 12
  (`FILTER_ROW_GAP` — audit, security, workflows, privileges); member
  privileges got its row two (اعضا | مدیران, counts, one card under it);
  the speakers directory's view/team row and the chat's room chips wear the
  chip; the audit table lost its header row (`hideHeader`). Projects is the
  one page whose scope chips sit in ROW ONE, before «مهلت امروز» — the user's
  ruling for that page, not a loosening of the rule.

- **Done on 2026-09-05:** the create button sits at the END of row 1 in one
  coat, `.btn btn-primary`, on every page that has one — workflows (it stood
  in its own row above the tabs), models (it stood under the menu, beside the
  count), agents (beside a sentence, now gone), chat («اتاق تازه» was a compact
  green), meetings (was an outline green). `TwoPane` grew an `actions` slot so
  a section page hands its button to the menu row instead of drawing a row.
- **Still to do:** one `Toolbar` component that every list page renders (tabs ·
  divider · filters · primary at END; row 2 scope), replacing the eight
  hand-composed rows, with a guard against `role="tablist"` outside it.

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

### R4 · The control family — SOLID (ruled (a) 2026-09-05; swept, guarded, re-measured)

- **The rule:** **three control sizes and no fourth** — `.btn` 38 (r11,
  12.5/600) · `.btn-sm` 34 (r8, 12.5/600) · `.btn-icon` 28×28 (r8) — with the
  coats primary / secondary / ghost / danger, and `.tap` for 44 below md.
  **A height, a min-height override or a text size written beside `btn` is
  a defect.** A glyph inside a control (an emoji, a count) sizes ITSELF on a
  child span; the control does not.
- **What was measured (before):** `.btn` carries `min-h-control`, and
  min-height beats any smaller height written beside it, so every control
  that tried to be smaller by writing `h-[…]` on a `.btn` rendered at 38 (42
  at 1920): the panel chips (`h-[34px]`) measured **42**; the panel tabs
  (`h-[32px]` in a 42 bar) measured **42**, edge to edge; `TOP_BUTTON
  h-[30px]` and the 40/42 footer the same. The numbers measured off the
  reference and asserted by `panelStyle.test` never reached the screen — the
  test read the string. Twenty more sites had re-sized a themed control with
  `h-7…h-10 min-h-0 text-xs/sm` (five heights), and twelve icon buttons carried
  a text size for the emoji inside them.
- **The sweep:** `panelStyle` chips, tabs and top button → `btn-sm`; the
  footer → `.btn` / `.btn-primary`; the tab bar lost its `h-[42px]` and is now
  the tabs plus 4px of padding (34 + 8 = 42, and it grows with the root as the
  tabs do); the reference's 9px chip corner rounds to the family's 8. Twenty
  static sites → `btn`, `btn-sm`, `btn-primary btn-sm`, `btn-secondary
  btn-sm`. Emoji wells keep `btn btn-icon` and size the glyph on a span.
- **Solid =** `control.guard` R4 check: on any pressable element wearing
  `btn`, a fixed height, `min-h-*` or a text utility fails the suite — no
  worklist, zero entries. Its first run found the twelve emoji wells the grep
  had missed (a true positive before any green); the pattern is proven both
  ways on synthetic tags (six caught, seven ignored). `panelStyle.test` asserts
  the family classes and the ABSENCE of any hand size.
- **Re-measured on production (2026-09-05, 1920 wide, root 17.5):** new-task
  chips **37** (= the 34 token; were 42), detail tabs **37** inside a **48**
  bar (34 + padding + border; were 42 in 42), footer primary **42** (= 38),
  `btn-sm` corners 8. The dialog itself still rounds at 12 — that is R8.
- **Still open under this rule:** the board's column names are unstyled 23px
  buttons (rename-in-place text, not chrome) — decided with R17.

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

### R7 · Surfaces — SOLID (2026-09-05): three surfaces and nothing else

- **The rule.** Three surfaces, each a class in `globals.css`; an inline
  recipe is a defect.
  - **`.card`** — a PAGE BLOCK: 18 (`rounded-2xl` = `radius.modal`), hairline
    border, the surface, 16px inset, the ambient `shadow-card`.
  - **`.card-row`** — a card in a LIST (a board card, a meeting in its list, a
    record in a column): 16 (`rounded-xl` = `radius.tile`), the surface, 12px
    inset, `shadow-card`, a stronger edge under the pointer.
  - **`.well`** — a row INSIDE a card: 16, recessed one step
    (`bg-surface-2/40`), NO shadow — a shadow inside a shadowed card is mud.
  - `.tile` IS a card: 18 (was 20) on `shadow-card` (was `shadow-island`, the
    dialog's). `.tile-row` and `.table-cards` rows keep 16.
  - Floating layers — menus, popovers, dialog panels — are not this rule's:
    they wear the island shadow and belong to R8/R10.
- **What was found.** 74 hand-rolled recipes in 32 files by the guard's own
  count (the first grep said 70) against 15 `.card` uses: two corners (18 and
  20), five grounds (`bg-surface`, `bg-surface-2`, `/40`, `/50`, a tint),
  insets from `p-2` to `p-7`, and shadow by accident — workflow and agent
  cards carried none, settings cards and board columns did. Nobody was
  careless: the theme offered ONE class and screens needed three shapes, so
  every screen drew the other two.
- **The sweep (30 files, 50 recipes).** → `card`: agent and workflow cards
  (`p-7` gone), Skeleton, FormPanel, MailDraftCard, the whiteboard canvas, the
  live Stage, MiniTasks' column, Review, TaskViews' pane, CreateOrg, the error
  page, the platform console's warning card, the board's add-column editor,
  the workflow page's three blocks. → `card-row`: ItemsPanel rows, MiniTasks
  rows, the meeting's live pill, the speakers list. → `well`: Recorder ×4,
  AgentDetail, IntegrationDetail, Integrations, MailDraftCard's quote,
  MeetingPage ×4, the meetings composer, ProjectDetail's note, TaskDetail ×2,
  TaskDialogs, WorkflowBuilder ×2, the workflow page ×3. **The board's card is
  the theme's list card**: `BOARD_CARD = "card-row cursor-pointer"`
  (board.guard's literal updated). TaskViews' segmented box was R4's
  `TAB_BAR` wearing a card recipe and now reads the constant.
- **Kept, as entries WITH reasons** (24, in `surface.guard.test.ts`): ten
  floating layers in eight files (date/time popovers, the Select listbox, the
  account menu, the bell, the emoji panel, the tone popover, the Jalali
  picker, the whiteboard's two toolbars) → R10; seven dialog panels (Overlay,
  the confirm dialog, SetMemberPassword, TourOverlay, WorkflowBuilder,
  WorkflowRunDialog, the platform console) → R8's second pass; four fields
  wearing a card's corner (the task title and description editors, the label
  field and its popover) → R5; the one detail frame (R18), the rail (R1), the
  assistant's composer (a structural exception by ruling).
- **Solid =** `surface.guard.test.ts`: (1) over every `.tsx` outside `ui/`, a
  className carrying a card corner AND a border AND a surface ground is a
  hand-rolled card, and each file's count must EQUAL its entry — more is a
  regression, fewer is a stale entry — with synthetic controls for chips,
  inputs and the three classes; (2) `.tile`'s literal radius ==
  `SCAFFOLD.radius.modal` and its shadow == `--shadow-card`, read from the
  rule body, not the comment beside it; (3) `.card-row` and `.well` exist.
  Verified red three ways: on the un-swept tree (32 files named, tile
  20/island), on a recipe staged back into Skeleton, and on a stale count
  (Overlay recorded as 2) — each fired on exactly its own line.
- **Re-measured on production (2026-09-05, 1920 × 855, root 17.5px):**
  `.card` on the settings FormPanel, the workflow cards and the workflow
  page's blocks — corner 18, inset 17.5 (= 1rem; the workflow card had been
  30.6 at `p-7`), shadow `0 2px 10px rgba(0,0,0,.34)`; `.card-row` on the
  task board — 16, inset 13.1, the same shadow; `.well` on the workflow page
  (seven of them) — 16, ground `rgba(39,44,50,.4)`, no shadow; the meeting
  row (`tile tile-row`) — shadow from the island's `0 6px 28px .46` to the
  card's `0 2px 10px .34`, corner 16 by the row override; the loaded `.tile`
  rule reads `border-radius: 18px; box-shadow: var(--shadow-card)`. No plain
  tile stood on a page I could reach (`/fa/dashboard` is not a route), so the
  18 is a stylesheet reading, not a computed one.

- **2026-09-05, evening (ruling 15):** a row inside a card is a row divided
  by a hairline, never a `.well`/bordered box inside the card — the assistant
  settings' switches and the agent dialog's web switch lost their boxes.

### R8 · Dialogs and panels — SOLID (2026-09-05)

- **Fixed:** `ui/dialog.tsx` and `ui/alert-dialog.tsx` carried `sm:rounded-lg`
  in their base class list; it is the panel token (`rounded-2xl`, 18) now, so
  `Overlay` and `ConfirmDialog` render the corner they declare.
- **Solid =** `dialog.radius.test.tsx` renders both and asserts the class list
  carries the token and NO responsive corner that could outrank it — red
  against the shipped base (`sm:rounded-lg` beside `rounded-2xl`), green after.
- **Re-measured on production (2026-09-05):** the new-task and new-meeting
  dialogs at **18** (were 12); the project panel at 18 with its 283 rail.
- **SECTIONS DIVIDED (ruling 11, 2026-09-05 evening):** every dialog body is
  `DIALOG_BODY` (panelStyle) — each field a section, a hairline between them
  drawn by the container, the same air on both sides — and a dialog that is
  one block (a search over a list) is an entry WITH ITS REASON in
  `dialogSections.guard.test.ts`, which fails a new `<Overlay` that reads
  neither. Footers carry the hairline above them everywhere. An empty
  section keeps its room (`SECTION_EMPTY`): «موردی ندارد» sits where the
  items would.

#### The record of the defect

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
- **Fixed inside panels (2026-09-05 evening):** an empty section of a detail
  keeps the height its items would take (`SECTION_EMPTY`), so the structure
  the dividers draw does not collapse around a missing answer.

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
- **Typed digits follow the language (user, 2026-09-05):** in fa, digits a
  person types into an RTL text field become Persian as they type
  (`PersianDigitsTyping`, one capture-phase listener in the locale layout,
  rewriting through the native setter so React stores the converted value);
  fields pinned `dir="ltr"`, emails, numbers and passwords keep ASCII, and
  Arabic-Indic digits become Persian too. `PersianDigitsTyping.test` — each
  positive case beside a control that must not convert.

### R16 · Motion — PROSE

- Controls 150ms; a message arrives with a 6px rise over 420ms; dialogs zoom
  from 98% over 150ms; `prefers-reduced-motion` stops all of it. No guard;
  `units.guard` covers the units.

### R17 · Boards — SOLID (2026-09-05): one board, one module

- **The rule:** the tasks board and the projects board are ONE shape, read
  from `components/platform/board/boardStyle.tsx` — lane, column (300 · r18 ·
  surface · card shadow · 10px inset · 70vh floor), header (tone well · title
  13/600 · count · acts), cards box, card (r16 · surface · 12px inset · card
  shadow), add row (the dashed compact control). A literal from that list in
  either board file is a defect.
- **What was measured:** the projects board had been written from the task
  board's numbers the day before and had already drifted — a 12px column
  title against 13, the count badge in a different corner, cards in a
  different box (`.tile` at r20 against the board's r16 card), no tone on the
  column.
- **Solid =** `board.guard.test.ts`: both boards import the module, neither
  spells the six literals, and the module still says them (the control).
- **Open under this rule:** the column name is still an unstyled rename-in-
  place button; the header's acts on projects are read-only by design (a
  column is edited on the board that owns it).

### R18 · Detail surfaces — SOLID for the frame (2026-09-05); the remaining pages PROPOSED

- **The rule (user, 2026-09-05):** a thing in a list opens as a POP-UP over the
  list, in ONE frame — `DetailPanel`: the fixed backdrop, the card at the panel
  corner, a top bar (close · ⋯ · edit at the start, the context acts at the
  end), a body and a 283px rail. It keeps an address (`?task=`, `?project=`)
  so a link still lands on the thing.
- **Done:** the task detail's frame was EXTRACTED to `DetailPanel` and the
  task detail re-reads it; the project detail — a page yesterday, wearing the
  same anatomy drawn a second time — is the panel's content now, opened from
  the board, the list and the calendar via `/projects?project=<id>`;
  `/projects/<id>` redirects there. Its acts match the task's: ⋯ holds
  archive/restore and the red delete, «ویرایش» beside it, the board link and
  «واگذاری کار» at the end.
- **Solid =** `detailPanel.guard.test.ts`: the frame's first line exists in
  exactly one file, and both details render `<DetailPanel>`.
- **2026-09-05, evening (ruling 11):** the frame divides its body and its
  rail (`PANEL_SECTIONS` / `RAIL_SECTIONS`) — each child a section with a
  hairline between; the task detail's tab bar and its content became one
  section so the line does not cut between them, and the project detail's
  title and summary one block.
- **Still pages, to rule on one by one:** agent (`/agents/[handle]`),
  workflow (`/workflows/[handle]`), meeting (`/meetings/[id]` — it runs the
  recorder and the stages, which may be the one that stays a page), member
  (`MemberDetail`), integration (`/integrations/[slug]`). Each opens as the
  panel unless the user says "except this part".

### R19 · Composers — PROPOSED · two

- **Today:** the room composer (two fixed lines, `dir="ltr"` row, @ / mic /
  emoji at the left, outline send at the right) and the assistant composer
  (growing textarea, «+», mic, send). Two composers, two shapes, one mic hook.
- **Proposed rule:** one `Composer` with slots; the mic tone from `micTone`.

### R20 · Surfaces outside the shell — PROPOSED

- `/platform` (vendor) and `/join/[code]` (guest) own their documents by
  design; their CONTROLS are still the family's. Today the console uses pill
  chips and its own header buttons.

### R21 · No explanations under titles and headers — SOLID (ruled and swept 2026-09-05)

- **The rule (user):** a title is the name. At most one sentence, and only
  when leaving it out would cost something — which turned out to mean four
  kinds and nothing else: a STATE (what a screen says instead of its content:
  the admin-only refusal, the pending screen, a record still processing, an
  empty canvas), an ARRIVAL (a stranger's first screen), a CONSEQUENCE (what a
  press does that its name cannot carry: a rename that reaches the board, a
  schedule that comes back, what deleting a member does), a CONSTRAINT (the
  logo's format, what a connection reads, what a key's permission grants).
- **Swept:** ~40 paragraphs — a sentence under every settings card title, a
  paragraph under every notification toggle (the auto-draft row keeps its one
  consent sentence: "nothing is sent without you pressing send"), the intro
  above the agents grid, the subtitles under the new-task and new-meeting
  dialog titles, the privacy note above the audit table, section notes on
  skills/security/sessions, the workflow builder's field hints, the
  whiteboard's and the meeting page's overlays (two of which came BACK as
  state and consequence — the first sweep took them and the guard's kinds
  put them where they belong). `Section` lost its `description` prop
  entirely, so a new page cannot grow one and typecheck.
- **Solid =** `copy.guard.test.ts`: a `<p>` or block `<span>` whose whole
  content is a translated key named as an explanation (`…Hint`, `…Note`,
  `…Desc`, `…Subtitle`, `intro`) fails the suite unless it is an entry with
  its kind and reason; the control test makes the pattern answer NO to a
  field's own hint slot, an empty state, a value and a heading. A hint that
  IS important goes in the control's own slot (`Field hint=`), which the
  guard does not read.

## Bugs found while measuring (not rules — fixes)

1. `/fa/settings/<unknown-slug>` renders the GENERAL pane under a breadcrumb
   that reads the raw key `settings.section.<slug>` — an unknown section must
   404 or land on `/settings`, and the trail must never print a key.
2. `.btn` min-height (R4) and the dialog radius (R8) — real, measured,
   invisible in the source.
3. **Speed (measured on production, 2026-09-05 evening):** one dashboard load
   asked `/api/meetings` nine times and `/api/tasks/board` twice; every page
   fetched its data twice (the page remounts when the display preferences
   hydrate with `/api/me`); and every BFF call ran in Vercel's `iad1` on its
   way to a server in Germany (`x-vercel-id: cdg1::iad1`, ~500–700 ms a
   call). Fixed with a 5-second burst tier in the client's read cache and
   `web/vercel.json` → `fra1`; re-measured after deploy.

## Order proposed

R4 ✓ → R8 ✓ → R7 ✓ → R6 → R3's one-`Toolbar` half (+R14's primary coat) → R5
→ R17 ✓ → R18 ✓ (frame; pages remain) → R19 → R12 → R20 → R16. The first two
were pure defects with a one-file cause; the next three are the sweeps that
make pages stop looking hand-made; the rest are compositions the user should
see before they are drawn. **Next: R6** — 212 raw px sizes in 47 files, row
titles at 16 vs the reference's 14/700, and the Persian font decision (three
candidates shown before one is chosen).
