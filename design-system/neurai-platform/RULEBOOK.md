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

### 1a. Three surfaces stand OUTSIDE the shell, and each says why

| Surface | Why no shell | Its own chrome |
|---|---|---|
| the gate (`/sign-in`, `/forgot`, `/reset`, `/pending`, `/suspended`) | there is no session yet | `/sign-in` is TWO HALVES (2026-09-16): the demo on the physical left (`(auth)/DemoPanel` — the video when `NEXT_PUBLIC_DEMO_VIDEO_URL` names one, the product's own scenes until then) and the door on the physical right in both locales, one `.card` with the four provider doors, «یا», the email field and «already signed up»; the other four screens are one `.card` in the middle of the page |
| the guest door (`/join/[code]`) | the person has no account; every shell element would be a door that refuses | one `.card`, then the room |
| the first-time flow (`/onboarding`, M54) | the person is in, but the flow is walked once, in order; every shell door leads out of it | `onboarding/OnboardingFrame`: the five-stage rail, its progress bar, the language pair; three layouts (split / centred / reveal) |

Their controls are the kit's (`.btn`, `.card`, `.well`, `Select`, the
icons); what they draw for themselves is only the chrome named above. The
trail's `NO_TRAIL` and the assistant's silence list carry each with its
reason.

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
- A THIRD row (the folder strip) is ONE component: `platform/TopicStrip` —
  «همه» with its count, a chip per folder with its count and its ⋯ (rename,
  archive), the inline name box, the dashed `+` — on row two's rail
  (`FILTER_TRACK`). The task board and the meetings page both READ it
  (2026-09-16, "unify"); the board hangs its projects after the `+` through
  the same `TopicChip`. `topicStrip.guard` refuses a second drawing of a
  folder chip. The tasks page is the default for how a third row looks.
  The strip draws its rail INSIDE a `TOOLBAR_ROW` (2026-09-16, "the second
  one is longer in tasks, make it the same as the top length"): a bare flex
  track is block-level and spans the page column; inside the row it is as
  long as its chips, like every other rail.
- The projects page is the board's two rows (2026-09-16, corrected the same
  day): row one is the views, the sorts, a third grey track with
  «پروژه‌های من» and «مهلت امروز» as `toggleClass` toggles — the board's own
  toggles in the board's own place — and, on the views with no column
  (list, calendar, archive), the `.btn btn-primary` create in `end`; the
  kanban's columns keep their «افزودن پروژه» rows. Row two is the
  `TopicStrip` read EXACTLY as the board reads it — folder for folder:
  «همه پروژه‌ها» with its count, a chip per PROJECT FOLDER (db/0226)
  carrying how many projects sit in it, the ⋯ that renames in the inline
  box or archives, the dashed `+` that opens that box. A chip filters the
  page to the folder's projects; the project dialog and the detail's rail
  carry the «پوشه» row. An admin's row (0186): `canAdd={isAdmin}` and an
  empty `menuFor` for a member, who sees chips and nothing to press. The
  strip's `+` is never a project's door — "the bar in the second sub menu is
  just folder and new folder button, not the new projects".
- A picture that can be changed is ONE control, `platform/PictureControl`
  (2026-09-16): the picture, a camera badge on its corner that opens the
  picker, a trash beside it while there is something to remove, the words
  as the buttons' names only. The profile photo and the organisation's logo
  both read it; a second «تعویض» button or a «حذف عکس» text link beside a
  picture is the second telling.
- The two meeting create dialogs carry `platform/MeetingAttendeesField`
  (2026-09-16): it is the KIT'S DROPDOWN, the same control as the folder row
  above it — the host as a row that is visible and unselectable, the roster
  as the rest, the closed control naming everyone who is coming. A guest is a
  typed name in its own box under it, because a name that does not exist yet
  cannot be a row in a list of people who do. Colleagues are added through
  0202's attendees route AFTER the create, guests ride it as `invitees`.
- `components/Select` takes ONE value or MANY, through a union in its props
  (2026-09-16): `value`/`onChange`, or `values`/`onToggle` with an optional
  `summary`. With many, the panel stays open on a press, the listbox says
  `aria-multiselectable`, and a chosen row carries a check. There is no
  second dropdown: a new picker adds a mode here, never a panel of its own.
- The organisation's logo is a CIRCLE, the profile photo's shape
  (2026-09-16): the two are one control at one size, and the corner was the
  last thing telling a reader they were two features.
- The assistant sidebar's composer is the send key at the row's start and the
  MIC at its end (2026-09-16), and nothing else. Its `+` menu is gone —
  «گفت‌وگوی تازه» lives in the panel's header (`SessionMenu`'s `onNew`), and
  the connectors shortcut is Home's sidebar row and Settings · اتصال‌ها.
- The task board draws no add-column slot (2026-09-16): the lane is exactly
  its columns.
- The meetings page is TWO rows (2026-09-16, later): row one carries the
  slice filter AND the sort — a second grey `TAB_TRACK` with the field as
  tabs, a divider and the direction key, in row one's own pill — with the
  two create buttons in `end`; row two is the `TopicStrip`, whose `end` slot
  holds one tinted track: the list/calendar keys, a `TRACK_DIVIDER`, and a
  SEARCH KEY that is a glyph until pressed and then a field growing into the
  row beside it (closing it clears the query). A search is a key on the
  rail, never a box beside it.
- The first row's OTHER END is `TwoPane`'s / `Toolbar`'s `end` slot: the
  create button (R3), or — on Profile — «خروج» as a pill in its own
  `TAB_TRACK` (2026-09-16), the row's own shape rather than a button of
  another family.
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
| Button | `.btn` / `.btn-primary` / `.btn-secondary` at 42 — the sub-menu rail's own box (34 + 8), on the rail's `rounded-xl` corner and the pill's weight 500 (user, 2026-09-16: "the style of the top bar menu and the buttons must be the same") · `.btn-sm` at 34 (the rail's pill, `rounded-xl`) · `.btn-icon` at 28 · `.btn-icon-sm` at 34 (`globals.css`) — a height, min-height or text size written beside `btn` is a defect | `control.guard`, `units.guard` |
| Field | `.input` / `.input-sm`, `Field`, `FormRow` | `select.guard` |
| Card | `.card` (a page block) · `.card-row` (a card in a list) · `.well` (a row inside a card) · `.tile` is a card; a row of tiles says `tile-row` | `surface.guard`, `tileRow.guard` |
| Dialog / detail | `Overlay`, `ConfirmDialog`, `DetailPanel`; body rhythm from `panelStyle` (`DIALOG_BODY`, `PANEL_SECTIONS`, `RAIL_SECTIONS`) | `dialogSections.guard`, `detailPanel.guard`, `nativeDialog.guard` |
| Board | `board/boardStyle.tsx` — columns are equal shares of the lane with a 14rem floor | `board.guard` |
| Menu | `KebabMenu` / `ContextMenu` (`components/rowActions.tsx`) — the panel is as wide as its longest entry (`w-max`, a 9rem floor, a 20rem ceiling; user, 2026-09-16: "too long, make them adjustable based on the text"), and a flyout is PORTALED beside its parent, never rendered inside it (the parent's overflow clipped it to a 12px sliver) | `submenu.guard`, `rowActions.menu.test` |
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
- Controls: `h-control` 42 (= the rail: 34 + 8) · `h-control-sm` 34 · `h-control-icon` 28 ·
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
