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

**The two sub-menus** are `platform/sectionTabs.tsx`, and they are design «ج»
(the user's choice, 2026-09-17, from three compact designs drawn against the
toolbar of the day — 70px to the first content where it had been 104):

```
row one   TAB_TRACK     + sectionTabClass(active)   a SEGMENTED CONTROL: the recessed track,
                                                     3px around 28px pills (`.btn-xs`), the
                                                     chosen pill lifted with the card shadow
          ToolbarMenu   + MenuRadio / MenuCheck      «مرتب‌سازی», «فیلتر»: a ghost `btn-sm`
                                                     button with the label, the current value,
                                                     a COUNT of the filters that are on, a
                                                     chevron; the ⋯ menu's own panel
row two   FILTER_TRACK  + filterChipClass(active)   a LINE of `.filter-chip`s — 24 tall, outlined,
                                                     the accent's edge and tint when on; no
                                                     rail under them
```

- Only the things a person SWITCHES BETWEEN stay in view (the views, the
  slices); the sort and the on/off filters live behind the two menus, and
  the «فیلتر» button's badge counts what is on — a filter behind a closed
  menu is invisible, and the count is what keeps a narrowed page from
  reading as the whole page. `MenuRadio` answers "which one" and closes;
  `MenuCheck` answers "on or off" and keeps the menu open, so two filters
  are one visit.
- `<SectionTabs tabs active onSelect />` renders row one; `<FilterChips chips
  active onSelect />` renders row two (each chip carries an icon, a label and
  optionally a count).
- A track never wraps — it scrolls; a row (`<Toolbar end={…}>` or
  `TOOLBAR_ROW` + `TOOLBAR_GROUPS`) wraps its tracks as units. Dividers go
  inside a track (`TRACK_DIVIDER`). The row's own actions (the create button)
  sit in `end` and wear `btn-sm` — the segmented control's own height; a
  full `.btn` beside it is the two-families-on-one-line fault.
- An on/off filter that stays ON THE ROW (the call page's «مقایسه») is
  `toggleClass(on)` with `aria-pressed` — a segmented pill lifting on its
  own; a page toolbar's own on/off filters go in «فیلتر».
- The pill (`.btn-xs`, 28) and the chip (`.filter-chip`, 24) are kit shapes in
  `globals.css`; `units.guard` cross-reads their size tokens, `toolbar.guard`
  refuses a tab drawn without the kit and holds the kit to the track, the
  pill and the chip, and `filterChips.test` records the reversal of the
  2026-09-15 "one geometry in two colours" toolbar.
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
  day; design «ج» 2026-09-17): row one is the views as the segmented
  control, «مرتب‌سازی» reading its field on the row, «فیلتر» holding
  «پروژه‌های من» and «مهلت امروز» as check rows and counting the ones that
  are on — the board's own row — and the `btn-primary btn-sm` create in
  `end` on EVERY view (2026-09-17: "add a new project and new tasks in the
  sub-menu top for each page, the related one, at the end of the first
  sub-menu top" — reversing 2026-09-05 for the kanban, whose columns keep
  their «افزودن پروژه» rows as well). Row two is the
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
  picture is the second telling. The profile's «تصویر پروفایل» (2026-09-17)
  is that control, a vertical hairline, then EIGHT READY-MADE AVATARS
  (`platform/avatarPresets`, five women then three men, each a round 36px
  key named «آواتار ۱» …) — a preset takes the photo's own road: rasterised
  to the same 256px JPEG, shown in the accept card, uploaded on the accept
  and never before. The eight are GENERATED, never drawn or edited by hand
  (2026-09-17, "use something better designed"): DiceBear's Avataaars
  (Pablo Stanley, free for commercial use) through
  `scripts/gen-avatar-presets.mjs`, every trait pinned by name, the module
  checked against the script by `avatarPresets.test`. A key is an `<img>`
  data URL and never the SVG inlined — the SVGs share DiceBear's element
  ids, and eight in one document resolve them all to the first.
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
- The meetings page is TWO rows (2026-09-16, later; design «ج» 2026-09-17,
  corrected the same day): row one carries ONE segmented control — the slice
  filter, a `TRACK_DIVIDER`, then the list/calendar keys with their words
  on the pills (the task board's shape: one rail, two questions) — and
  «مرتب‌سازی» reading its field on the row (the three fields as radio rows,
  the direction «تازه‌ترین اول» as a check row under them), with the two
  create buttons in `end` at `btn-sm`; row two is the `TopicStrip` — a bare
  line of folder chips — with the SEARCH KEY in its `end` slot: at the
  row's END (the left edge of a Persian screen), a glyph (`btn-ghost
  btn-icon`, the line's own 28) until pressed and then a field that opens on
  the key's START side, toward the chips (closing it clears the query). A
  search is a key on a row, never a box beside it.
- The first row's OTHER END is `TwoPane`'s / `Toolbar`'s `end` slot: the
  create button (R3) — «تسک جدید» on the board, «پروژهٔ جدید» on projects,
  «جلسه جدید» on meetings, on every view (2026-09-17), beside whatever
  in-column door the board also keeps — or, on Profile, «خروج» as a pill in
  its own `TAB_TRACK` (2026-09-16), the row's own shape rather than a button
  of another family.
- An in-page SEARCH is a tool at the END of a toolbar row — never a row of
  its own and never first in the row: a KEY at the end of the folder line
  that opens into a field toward the chips (meetings, 2026-09-17), or the
  compact field (`.input-sm`, 34px like the controls beside it) at the row's
  END edge on the integrations and console pages.
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
| Button | ONE SIZE FAMILY: `.btn` at 42 (34 + 8, the height the sub-menu rail set on 2026-09-16) on the panel corner `rounded-lg` (12) at weight 500 · `.btn-sm` at 34 · `.btn-icon` at 28 · `.btn-icon-sm` at 34 · `.btn-icon-lg` at 42. THE TACTILE FAMILY IN INK (user, 2026-09-18, chosen from the nine-way canvas — three designs in three colourways): every FILLED coat wears a lit top edge, an inner gradient and a small drop and presses IN; the primary's fill is `--btn`, the page's own ink (near-white on dark, near-black on light), and the green stays the accent for everything that is not a button. ONE COAT SET, each written only in `globals.css` (2026-09-17 — 133 spellings counted, 51 of them an outlined secondary drawn by hand beside the kit's filled one): `btn-primary` (the act, in ink) · `btn-secondary` (a raised neutral, every other button INCLUDING a dialog's cancel — `panelStyle.FOOTER_CANCEL` reads it) · `btn-ghost` (a quiet act, and EVERY icon button: `btn-ghost btn-icon`; flat, no lip) · `btn-soft` (a chosen state on the ink's tint, flatter than the secondary) · `btn-dashed` (an add slot) · `btn-danger` (the destructive yes, the same recipe in red) · `btn-ghost-danger` (quiet until the pointer, then red). A ground, edge, shadow, ink or weight beside `btn` is a defect | `buttonCoat.guard`, `buttonTactile.test`, `control.guard`, `units.guard` |
| Field | `.input` / `.input-sm`, `Field`, `FormRow` | `select.guard` |
| Card | `.card` (a page block) · `.card-row` (a card in a list) · `.well` (a row inside a card) · `.tile` is a card; a row of tiles says `tile-row` | `surface.guard`, `tileRow.guard` |
| Dialog / detail | `Overlay`, `ConfirmDialog`, `DetailPanel`; body rhythm from `panelStyle` (`DIALOG_BODY`, `PANEL_SECTIONS`, `RAIL_SECTIONS`) | `dialogSections.guard`, `detailPanel.guard`, `nativeDialog.guard` |
| Board | `board/boardStyle.tsx` — columns are equal shares of the lane with a 14rem floor | `board.guard` |
| Menu | `KebabMenu` / `ContextMenu` (`components/rowActions.tsx`) — the panel is as wide as its longest entry (`w-max`, a 9rem floor, a 20rem ceiling; user, 2026-09-16: "too long, make them adjustable based on the text"), and a flyout is PORTALED beside its parent, never rendered inside it (the parent's overflow clipped it to a 12px sliver) | `submenu.guard`, `rowActions.menu.test` |
| Icon | `components/icons.tsx`, 12 / 14 / 16 / 18 | `icons.guard` |
| Heading | FIVE ROLES and nothing else (2026-09-17 — forty-six spellings counted): `.h-page` 16/700 (a page's or a gate card's name) · `.h-dialog` 15/700 (a dialog's or a detail's name — `panelStyle.DIALOG_TITLE`) · `.h-section` 15/600 (a block inside a page) · `.h-card` 14/600 (a card's or tile's title) · `.h-label` 11/600 subtle (a group label). A size, weight or ink utility on an `<h1..h4>` is a defect; four files are named exceptions with their reasons | `heading.guard` |
| Field | ONE HEIGHT: `.input` is 40 on every surface — the dialog kit's `PANEL_INPUT` no longer pins its own 45 (2026-09-17: the new-task dialog rendered its title field at 42 beside its folder dropdown at 38) | `select.guard` |
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
