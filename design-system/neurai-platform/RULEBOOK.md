# NeurAI Platform — THE KIT

**This file replaced the rulebook on 2026-09-15**, on the user's word: "I want
to remove the rules and get what we have right now to become solid and unified,
not for an upcoming section to check all the rules and have problems mid-task.
We are doing this first and for the last time."

So there are no rules to check any more. There is a KIT — a small set of
components and class strings that ARE the design — and one instruction:

> **Build a screen out of the kit. Never draw a shape the kit already has.**

Every shape below is written in exactly one file, every page reads it from
there, and a guard in `pnpm test` refuses the spelling that goes round it. That
is what "solid" means here: the wrong shape has no spelling, so nobody has to
remember not to write it. The previous rulebook's twenty-four numbered rules,
their statuses and their measurements live in git (`git show cc57f81:design-
system/neurai-platform/RULEBOOK.md`); the decisions they recorded are now the
comments beside the code they govern.

---

## 1. The shell — four fixtures, one face each

| Fixture | Where it lives | To add one more |
|---|---|---|
| **Main menu** (the icon rail, home / meetings / tasks …) | `platform/IconRail.tsx`, entries in `platform/nav.ts` (`NAV_PRIMARY`, `NAV_UTILITY`), glyphs in `platform/icons.tsx` (`NAV_ICON`) | one entry in `nav.ts` + one glyph in `NAV_ICON`. `navLabels.guard` and `nav.test` refuse an entry with no label or no icon. |
| **Top bar** (trail, search, bell, chat, theme, locale) | `platform/TopBar.tsx` | it is one component; a page never draws its own bar. |
| **Side sub-menu** (Home's conversations column) | tokens in `scaffold/sideMenu.ts`: `SIDE_MENU_COLUMN`, `sideMenuRowClass(active, "row" \| "sub")` | a page that grows a menu beside it renders those two strings. `SectionMenu` (the scaffold's vertical menu) reads the same row, so a vertical menu has one face wherever it stands. |
| **Assistant** (every page but Home) | `platform/AssistantSidebar.tsx` | nothing — it is the shell's. |

Below `md` the rail becomes the bottom bar, the assistant becomes a sheet
behind the door in the top bar, and Home's column becomes a slide-over. Between
`md` and `lg` the assistant floats over the page; from `lg` the shell reserves
its width (`PlatformShell`: `md:pe-assistant lg:pe-[var(--assistant-rail)]`).

## 2. The page — a share of the screen, and two sub-menus

**Width.** `PageContainer` (`scaffold/Page.tsx`) is the column and it is the
whole width between the menus. A `normal` surface (a list, a board) keeps a
1 % gutter; a `small` one (a form, a reading page) a 3 % gutter — both with the
desktop gutter (24px) as the floor (`SCAFFOLD.page.gutterPct`). Nothing in a
page names a max-width in pixels.

**The two sub-menus** are `platform/sectionTabs.tsx`, and they are one design in
two colours — the meetings page's track:

```
row one   TAB_TRACK     + sectionTabClass(active)   recessed rail, lifted pill, fg ink
row two   FILTER_TRACK  + filterChipClass(active)   the same rail on the accent tint, accent ink
```

- `<SectionTabs tabs active onSelect />` renders row one; `<FilterChips chips
  active onSelect />` renders row two (each chip carries an icon, a label and
  optionally a count).
- A track never wraps — it scrolls; a row (`<Toolbar end={…}>` or
  `TOOLBAR_ROW` + `TOOLBAR_GROUPS`) wraps its tracks as units. Dividers go
  inside a track (`TRACK_DIVIDER`). The row's own actions (the create button,
  a view switch) sit in `end`.
- An on/off filter is `toggleClass(on)` with `aria-pressed` — the same pill,
  lifting on its own.
- A THIRD row (the task board's folder strip) is row two's rail again:
  `FILTER_TRACK`. The tasks page is the default for how a third row looks.
- An in-page SEARCH is a tool on its toolbar row, at the row's END edge, in
  the compact field (`.input-sm`, 34px like the pills beside it) — never a
  row of its own and never first in the row. Meetings is the shape; the
  integrations and console searches wear it too.
- A menu of ROUTES (Settings, Management, Profile, Help) is the same track:
  `TwoPane` renders its links with `sectionTabClass`.
- A tab strip inside a dialog is the same track: `panelStyle.TAB_BAR` is
  `TAB_TRACK`, `tabClass` is `sectionTabClass` plus `flex-1`.

`toolbar.guard` refuses a `role="tab"` in a file that does not import the kit,
and refuses the two recipes the kit retired (the filled accent tab, the rail
spelled by hand).

## 3. The content — one of each

| Thing | The one spelling | Guard |
|---|---|---|
| Table | `DataTable` (`components/DataTable.tsx`) — header, rows, skeleton, pager, menu, selection all inside it. It FITS its column and grows down: cells wrap, nothing scrolls sideways (user ruling 2026-09-15). Rows are the detail size with a 6px gap. | `loading.guard`, `confirm.guard` |
| Button | `.btn` / `.btn-primary` / `.btn-secondary` at 38 · `.btn-sm` at 34 · `.btn-icon` at 28 · `.btn-icon-sm` at 34 (`globals.css`) — a height, min-height or text size written beside `btn` is a defect | `control.guard`, `units.guard` |
| Field | `.input` / `.input-sm`, `Field`, `FormRow` | `select.guard` |
| Card | `.card` (a page block) · `.card-row` (a card in a list) · `.well` (a row inside a card) · `.tile` is a card; a row of tiles says `tile-row` | `surface.guard`, `tileRow.guard` |
| Dialog / detail | `Overlay`, `ConfirmDialog`, `DetailPanel`; body rhythm from `panelStyle` (`DIALOG_BODY`, `PANEL_SECTIONS`, `RAIL_SECTIONS`) | `dialogSections.guard`, `detailPanel.guard`, `nativeDialog.guard` |
| Board | `board/boardStyle.tsx` — columns are equal shares of the lane with a 14rem floor | `board.guard` |
| Menu | `KebabMenu` / `ContextMenu` (`components/rowActions.tsx`) | `submenu.guard` |
| Icon | `components/icons.tsx`, 12 / 14 / 16 / 18 | `icons.guard` |
| Copy under a title | none — a name, and at most one sentence when it matters | `copy.guard` |

## 4. Sizing — everything rides the screen

The root font-size is fluid (`globals.css`: 15.1px at 1280, 15.4 at 1440, 16.3
at 1920, 16.5 at 2560 — re-pitched 2026-09-15 so a monitor is not a magnified
laptop), so a size written in **rem** scales with the monitor and a size
written in **px** does not. Every size in the tree is a token or a rem:

- Type: `text-page-title` 16 · `text-section-title` 15 · `text-pane-title` 14 ·
  `text-menu-item` 13.5 · `text-sm` 13 · `text-detail` 12.5 · `text-caption` 11 ·
  `text-micro` 10 (`SCAFFOLD.fontSize` → `tailwind.config.ts`).
- Controls: `h-control` 38 · `h-control-sm` 34 · `h-control-icon` 28 ·
  `h-field` 40.
- Widths: a share (`%`, `flex-1`), a token, or a rem. Never `w-[300px]`.

`fluid.guard` refuses a px font size anywhere and a px box size over 3px
(the 44px touch floor is the one exception, and `units.guard` keeps THAT px on
purpose: a finger does not scale with the type).

## 5. Phone and tablet — the shell changes shape, the page does not

- `< md` (768): rail → bottom bar; assistant → sheet; Home's column → slide-over;
  every `.btn` grows a 44px hit area (`.tap`); tracks scroll sideways; the
  detail panel's rail stacks under its body; dialogs take the viewport minus
  2rem.
- `md`–`lg`: the rail is back; the assistant floats over the page when open.
- `≥ lg` (1024): the full desktop shell; the assistant reserves its width.

A page adds a breakpoint only for its own content (a grid that becomes one
column). It never re-implements a shell decision.

## 6. Colour and direction — settled, not here

Tokens in `tailwind.config.ts` / `globals.css`, verified by
`design-system/neurai-platform/verify-pairs.mjs` (contrast floors, the dark
ladder in L\*, the glass composites). Direction is the document's (`dir`),
Radix reads it through `DirectionProvider`, and a physical corner (`left`,
`right`, `rounded-tl`) is written only where a control is pinned `dir="ltr"`
and a test says why.

---

### How this file stays true

It names files and guards, never numbers a page might copy. When a shape
changes, change it in its one file and this table keeps pointing at it. When a
new shape is needed, it is added to the kit FIRST — a component and a guard —
and only then used on a page. The guards are the part that runs; this file is
the part a person reads to find them.
