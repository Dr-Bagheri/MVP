import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE CONTROL, ONE SHAPE.
 *
 * User directive, 2026-09-02: "the look of the platform is like 10 different
 * developers made it — one is small, one is big, one has one shape for button,
 * the other has the other one."
 *
 * That was measurable, and the measurement is the reason this file exists: on
 * the day it was written, 47 controls in this codebase had hand-rolled their
 * own geometry, in ELEVEN different shapes — h-10 rounded-xl, h-8 rounded-lg,
 * h-9 rounded-xl, h-11 rounded-xl, h-7 rounded-md, and on. Against 109 that
 * used `.btn`.
 *
 * Nobody was being careless. `.btn` offered exactly ONE size, so any screen
 * that wanted a compact control had to invent one, and eleven inventions is
 * what the directive was describing. The sizes exist now (`.btn-sm`,
 * `.btn-icon`, measured off the reference), so inventing a twelfth is a
 * choice rather than a necessity — and this is what makes it a visible one.
 *
 * REMAINING is not a permission list, it is a WORKLIST with a number beside
 * each entry. Converting a file means lowering its count; the assertion fails
 * either way — too many is a regression, too few is a stale entry that is
 * quietly making the guard smaller than it looks. An allow-list nobody has to
 * shrink is a backlog nobody can see.
 */
const SRC = join(process.cwd(), "src");

const REMAINING: Record<string, number> = {
  /* THE TWO DATE PICKERS, 2026-09-03 — one entry each, and one reason, because
     they are the same component written twice: the meeting form's month panel
     and the task board's are the same presets over the same grid.
     Converted in both: the month arrows (28px and centred already — only the
     corner differed, 12px against the icon button's 8: the AvatarEditor
     camera-badge finding again) and the preset chips, which this guard could
     not see at all because they spell no centring class. Those chips were the
     complaint in miniature — same four presets, same panel, two files, 11px
     muted with a 10px inset in one and 11.5px solid with a 12px inset in the
     other. `.btn btn-sm` in both now. Two more went with them that no check
     here counts: a restated `h-10` on each `.input` trigger, which pinned 40px
     at every width and so left the meeting form's date field UNDER the 44px
     ruling below md — and four pixels shorter than the title box in its own
     dialog, which is a bare `.input`.
     WHAT REMAINS is one MONTH-GRID CELL in each. A day is a cell, not a
     control with a label in it: the grid owns its width (seven tracks in a
     268/288px panel, where `.btn-icon` pins 28px and `.btn-sm` adds 13px of
     inline padding either side of a two-digit number), and both grids say
     which day is chosen — and which is today — with WEIGHT, which `.btn`'s own
     `font-semibold` would flatten across all forty-two cells at once. The
     cells already agree with each other; what they do not share is a button's
     anatomy, and dressing them in one would cost the selection its signal. */
  "components/DateTimeFields.tsx": 1,
  "components/platform/tasks/JalaliPicker.tsx": 1,
  "app/[locale]/(auth)/pending/page.tsx": 1,
  /* workflows/[handle]/page.tsx, 2026-09-03: four matches and NOT ONE of them
     is a control — the two this page had were invisible here, and both are
     converted. What the guard sees is the shape without the press:
       2 — icon wells, `aria-hidden` spans: the trigger card's mail/calendar
           glyph, and the never-run panel's empty mark;
       1 — the creator's initial in a circle, the avatar idiom a dozen files
           share;
       1 — a step's ORDINAL, the number beside the card. It keeps its fixed
           circle so the numbers line up down the column, exactly as
           WorkflowBuilder's does — a `.chip` grows with its digit and would
           shift the row the day a workflow reaches ۱۰.
     What went instead were the two the guard cannot count: the install button
     and «ویرایش مراحل» both carried `h-9 min-h-0 px-…` ON TOP of `.btn` — a
     hand-rolled control wearing the very class that exists to prevent one,
     unseeable BECAUSE the class it re-answers is present. Install also
     restated `.btn`'s disabled treatment with an opacity of its own.
     The page's two SWITCHES stay switches: the record toggle's track-and-knob
     and the on/off pill are that idiom, not buttons — and the pill's padding
     is pinned by detail.test.tsx for a bug that only exists on a pill. */
  "app/[locale]/workflows/[handle]/page.tsx": 4,
  /* THE AVATAR-AND-WELL FAMILY, 2026-09-03 — the eight files below, nine
     matches, and NOT ONE of them is a control. They all came through the same
     door: the fixed pattern reads `grid place-items-center`, which is how this
     platform spells a fixed box holding ONE glyph or ONE letter, and such a box
     shares a button's three utilities and nothing else.
     Two of the nine sit INSIDE the press — a table row and a list row carrying
     `role="button"` — where a button's face would draw a second, smaller target
     inside the first, on the element whose only job is to say WHICH. The other
     seven have no press near them at all, so dressing them would offer one that
     goes nowhere. A wrong conversion is worse than an honest entry.
     Two real controls DID go in this pass, and neither is countable here —
     which is the thing to know when these numbers read as short. Meetings'
     agenda-remove was a hand-drawn 34px square with the input's corner:
     `h-[34px]` is an ARBITRARY value and the `h-\d` pattern cannot read one, so
     every control sized in brackets is uncounted — a FOURTH blind spelling
     beside the grid, the template literal and `rounded-s-lg`. And OrgFields'
     locale select still carried the `min-h-0 h-11 … md:h-control` string the
     profile page's three selects were fixed for the day before: 38px beside the
     six 40px `.input` boxes in its own panel, one form with two field heights,
     the odd one out being the only control on it that is not a text box. */
  /* the suspended wall's danger mark — and it REJOINS this list rather than
     regressing onto it. Its entry was deleted on 2026-09-03 as "never a
     control"; the same audit made it the platform's 40px well, spelled
     `grid place-items-center`, which the old pattern could not read and the
     fixed one can. The file did not change. `aria-hidden` under the heading
     that carries the meaning, and the two things to press on that screen are
     already `.btn-primary` and `.btn-secondary`. */
  "app/[locale]/(auth)/suspended/page.tsx": 1,
  /* the guide's step ORDINAL, one per numbered instruction. It keeps a fixed
     24px circle so the digits line up down the list — the argument
     WorkflowBuilder's and AgentEditor's ordinals already carry two entries
     down: a `.chip` grows with its digit and would step the column sideways
     the day a section reaches ۱۰. Nothing presses a number in an `<ol>`. */
  "app/[locale]/help/[[...section]]/page.tsx": 1,
  /* the guest door's 44px video well, over «به جلسه بپیوندید». This screen
     renders OUTSIDE the shell deliberately — a stranger with no account, so
     every door on it would refuse — and it holds exactly ONE control, a
     `.btn-primary`. A button's face on the page's identity mark would put a
     second pressable-looking thing on the one screen that must not have one. */
  "app/[locale]/join/[code]/page.tsx": 1,
  /* the member row's initial, `aria-hidden`. The ROW is the control
     (`onRowClick` opens the detail panel) and every verb lives on its kebab.
     Six columns became a mark, a name and one line under it — dressing the
     mark would make the one thing in that cell which is not information look
     like the action. */
  "app/[locale]/management/users/page.tsx": 1,
  /* the profile header's 56px avatar: the person's photo when they have one,
     their initial when they do not. What CHANGES it is the AvatarEditor in the
     panel below, which owns the file picker and the crop — a button's face
     here would offer the upload in the one place on the page that does not
     do it. */
  "app/[locale]/profile/page.tsx": 1,
  /* the same avatar at 48px, in the panel that row opens. This file's one
     genuine hand-rolled control went on 2026-09-02: a 36px, 12px-cornered
     close drawn around a text glyph, beside every other dialog's 28px
     `.btn btn-icon`. */
  "components/platform/MemberDetail.tsx": 1,
  /* Meetings.tsx: two, and both are the shape without the press —
       1 — the row's calendar well, `aria-hidden`. The row itself carries
           `role="button"` and opens the meeting, so a press here would be the
           second-target case above, on the glyph that only says what kind of
           row this is;
       1 — the calendar's TODAY mark, the day number wearing the accent when
           the day is today. In a month cell the press is the meeting chip
           inside it, and TaskViews records the identical mark over its own
           grid in these same words — a shared idiom, not a stray.
     Everything pressable on this surface already wears the theme: the view and
     stage chips and the whole folder strip are `.btn btn-sm`, the dialog ✕ and
     the month arrows `.btn btn-icon`, «امروز» and both ends of the agenda
     `.btn-sm`. */
  "components/platform/Meetings.tsx": 2,
  /* the logo's EMPTY WELL — the «—» square standing exactly where the 48px
     `<img>` renders once a logo exists. It is the twin of an IMAGE, not a
     picker: what chooses a file is the `.btn btn-sm` beside it, and a button
     drawn where the picture goes would leave the real one reading as its
     caption. */
  "components/platform/OrgFields.tsx": 1,
  /* Pagination.tsx was never ON this list and had THREE — both step arrows and
     every page number, `h-9 rounded-lg` by hand: 36px with a 12px corner, in a
     product whose compact control is 34px with an 8px one. Two hid behind a
     grid-centred box and the third behind a template-literal className (the
     current page has an active state), which is both of this guard's blind
     spellings inside one 60-line component. They wear `.btn btn-sm` now, the
     arrows squared by `w-[34px] px-0`, and the two arrows read from ONE string
     — a pager whose back and forward drift apart is the whole subject of this
     file. `font-semibold` and `text-sm` left with the geometry: `.btn` says
     both, and restating them is how one row of buttons ends up in two weights.
     `tabular-nums` stayed, because that is about the digits, not the box. */
  "components/RichTextEditor.tsx": 1,
  /* Select.tsx, 2026-09-03: its one match is a LISTBOX OPTION and it STAYS.
     `.btn` centres its contents and wears a button's padding and corner; a
     dropdown row is full-width and start-aligned, carries a leading colour dot
     and truncates — dressed as a button it stops reading as a list to choose
     from and starts reading as a column of buttons. The platform's menu-row
     idiom is the one next door in rowActions (`ENTRY_CLASS`, and SelectMenu's
     own options): padding, no fixed height, full bleed. That the platform's
     TWO dropdown panels do not spell that idiom identically is a real finding
     and a larger change than a class swap — recorded rather than converted,
     because a wrong conversion is worse than an honest entry.
     One thing did leave the file, unseen by this guard (no corner in that
     string, which is worth knowing when this count reads as one): the trigger
     carried `h-10` ON TOP of `.input` — a height written over the class whose
     job is to answer that question, and answering it differently below md,
     where `.input` is 44 by the standing hit-area ruling. Nothing moved; a
     min-height outranks a height, so the ruling had been winning and the
     literal was only a fourth spelling of a number the theme owns. */
  "components/Select.tsx": 1,
  /* Recorder's three are the RECORD TRANSPORT and they are a SET: 40px round
     satellites around a 64px round record button. Three more members of that
     same row do not answer to this entry — the settings kebab hands its shape
     down as `triggerClassName`, which no className pattern reads, and the mic
     and source pickers wear `SelectMenu variant="round"`, whose 40px round
     trigger is ONE line in rowActions.tsx standing for both. So converting
     the three counted here would leave four round controls beside one
     8px-cornered rectangle: the "ten different developers" symptom inside a
     single row, on the product's centrepiece. The record button is an
     instrument rather than a button anyway — it wears the Echo mark and the
     take's state, at a size the theme has no name for. Redrawing that
     transport is a decision with the user, not a class-string edit.
     The file's other two matches went on 2026-09-03: the mark-this-moment
     button was a hand-written `.btn-icon` (28px, centred, only the corner
     differed) and the voice pill was a hand-written `.chip`. */
  "components/echo/Recorder.tsx": 3,
  /* echo/SpeakersDirectory.tsx, 2026-09-03: its entry said ONE and the fixed
     pattern found THREE, which is the stale-entry direction this list is
     supposed to fail in — the two it could not see were both `grid
     place-items-center`. Of the three, exactly one was a control: the ＋ that
     opens the add row, a 32px bordered box standing in a row with a 32px
     segment group and a 28px filter pill. All three of that row wear the
     theme's compact control now, in Meetings.tsx's own spelling (view chips,
     a hairline, filter chips) — a directory and two boards rendering the same
     toolbar must not disagree about what a filter looks like.
     SIX more went with them that this guard cannot count, five of them the
     invisible kind: `btn-primary` / `btn-secondary` / `btn-danger` with
     `h-8 min-h-0 px-3 text-xs` written ON TOP — a hand-rolled control wearing
     the very class that exists to prevent one, unseeable BECAUSE the string
     contains `btn`. The sixth is the enrollment panel's fa/en pair, a 28px
     segment group fused inside an `overflow-hidden` box, which TopBar renders
     as `.btn btn-sm` two screens away. Counted rather than asserted, because
     a claim in a comment is only worth what it was measured against: every
     button in this file was drawn at 28px or 32px — two hand-picked heights,
     neither of them one the theme has a name for — and all of them are the
     one compact control now. What that count also surfaced, and what is NOT
     fixed: five FIELDS still restate their size on `.input` (`h-9 min-h-0
     py-0`, and one `h-8`), pinning 36px over a class that says 44 below md
     and 40 above. It is the identical defect one control-family across, but
     the theme has no compact field to move them to — which is the exact
     position `.btn` was in before `.btn-sm` existed — and minting one is a
     globals.css decision, not a class swap inside one screen.
     What REMAINS is two AVATARS: a person's initial in a circle, at 40px on
     the card view and 28px in the org chart. Nothing presses them — in the
     card view the delete key beside it is the control, and in the chart the
     band is a reading, not a menu — and an initial dressed as a button offers
     a press that goes nowhere. */
  "components/echo/SpeakersDirectory.tsx": 2,
  /* AgentEditor.tsx, 2026-09-03: five matches, THREE of them controls and now
     the theme's — the four-step tab row (a segmented tab is exactly what
     `.btn-sm` was measured off) and the icon and colour pickers, a matched
     pair of 40px squares that both take `btn w-[38px] px-0`. Converting one
     row of two and leaving its twin is the "ten different developers"
     symptom inside one fieldset, so they moved together.
     Four more went with them that this guard cannot count: the back button
     (a 32px pill, no centring class to see) and all three footer buttons,
     which carried `h-9 min-h-0 px-4 text-sm` ON TOP of `.btn-primary` /
     `.btn-secondary` — a hand-rolled control wearing the very class that
     exists to prevent one, and invisible here BECAUSE the class it
     re-answers is present. Stripping those also gave Save the disabled
     appearance it had the attribute for and no look of.
     What REMAINS is two aria-hidden wells: the step ORDINAL inside each tab
     (a fixed 20px circle so the digits line up down the row — a `.chip`
     grows with its digit) and the read-only view's 64px identity mark, the
     same idiom the overview panel and the assistant header render. */
  "components/platform/AgentEditor.tsx": 2,
  /* AgentOverviewPanel.tsx's one is that same identity mark at 48px: an
     aria-hidden well carrying the agent's colour and icon, with nothing to
     press. Its one real control went on 2026-09-03 — the collapse button was
     the same hand-rolled 32px pill the editor's back button wore two files
     away, and this guard could see neither, because neither spells a
     centring class. */
  "components/platform/AgentOverviewPanel.tsx": 1,
  /* AvatarEditor's one is the AVATAR — the 64px circle holding either the
     photo or the person's initial. It is the shape without the press, and
     dressing it as a button would put a pressable-looking rectangle where a
     face goes. The control that was genuinely hiding beside it went on
     2026-09-03: the camera badge was a hand-written `.btn-icon` (28px and
     centred already), and the accept/cancel pair under the crop preview was
     `.btn` with `h-9 min-h-0 px-3 text-xs` bolted on top — a restated size,
     which this guard cannot see BECAUSE the class it re-answers is present.
     They are `.btn btn-icon` and `.btn-sm` now. */
  "components/platform/AvatarEditor.tsx": 1,
  /* dashboard/miniWidgets.tsx, 2026-09-03: three matches and NOT ONE of them
     is a control — nothing was converted here because nothing here is one.
     All three are the same idiom at three sizes, an `aria-hidden` icon WELL
     sitting beside the text that carries the meaning:
       1 — the provider's mark on each integration card. The whole card is a
           `Link`, so a button's face on the glyph would draw a second, inner
           press that does not exist;
       1 — the same well on each stat card, for the same reason;
       1 — the calendar glyph over «هیچ جلسه‌ای پیش رو نیست», decoration above
           a sentence, with nothing to press at all.
     The two chevrons that WERE controls here were converted on 2026-09-02 and
     wear `btn btn-icon`. Not counted and deliberately not converted either:
     the record transport — the settings key, pause/resume, the record button
     and the two round pickers. It is Recorder.tsx's own row, driving the same
     engine, and its sizes come from container units in globals.css rather
     than from a class here, so it carries no `h-*` for this guard to read.
     Converting the two of five that are plain buttons would leave three round
     satellites beside two 8px rectangles: the "ten different developers"
     symptom inside one instrument, which is exactly why Recorder.tsx's own
     entry says that redrawing the transport is a decision with the user
     rather than a class-string edit. */
  "components/platform/dashboard/miniWidgets.tsx": 3,
  /* AvatarMenu.tsx, 2026-09-03: one match, and it IS pressable — it opens
     the account menu — which is exactly why it stays. What decides its shape
     is that it holds a FACE: a 36px circle with `overflow-hidden` so a photo
     fills it, the identical spelling IconRail's foot avatar wears two files
     away and a dozen surfaces share. `.btn btn-icon` would make it a 28px
     square with an 8px corner, so the one element in the product whose job
     is showing a person would stop matching every other person on screen;
     and `btn … rounded-full` re-answers the corner `.btn` exists to own
     while moving the box to 38 — inventing a disagreement with the rail to
     remove one nobody can see. A wrong conversion is worse than an honest
     entry. Everything else in the menu is a menu ROW, which is its own
     idiom (start-aligned, full width) and carries no geometry to convert. */
  "components/platform/AvatarMenu.tsx": 1,
  /* Hub.tsx LEFT this list on 2026-09-02 (audit finding): its one entry was
     the Create chip's hand-rolled h-8 geometry, which wears `.chip` now.
     It RETURNS on 2026-09-03, for a different thing entirely and one the old
     pattern could not see: the 40px icon well inside each Create row — an
     icon-only `<span>`, where the ROW around it is the button. A well
     dressed as a button draws a second, smaller press inside the first.
     Nothing was converted here because everything that IS pressed already
     wears the theme: the composer's three keys are `btn w-[38px] px-0`, and
     the toolbar and both menu triggers come off one shared `.btn btn-sm`
     const — which is what stopped this file having a second button family. */
  "components/platform/Hub.tsx": 1,
  /* IconRail.tsx, 2026-09-03: two matches and NEITHER is a control —
       1 — the WORKSPACE MARK at the head of the rail, a 36px well holding
           the brand image. Nothing presses it; the card it sits in is not
           even a link;
       1 — the person's AVATAR at the foot, inside the link to their profile.
           The link is the control; the circle is what says WHO.
     The rail's two real controls went in earlier passes (the primary action
     is `.btn`, the sign-out `.btn btn-icon`). Its NAV ROWS are deliberately
     not converted and are not counted either — their classes live in a
     const, which no className pattern reads, and a menu row is a different
     idiom from a button: full width, start-aligned, 40px, and the 12px
     corner the reference gives a menu (the note at that line records what
     16 did to it). `.btn` centres its label, which is the wrong sentence
     for a sidebar. */
  "components/platform/IconRail.tsx": 2,
  /* IntegrationDetail.tsx, 2026-09-03: one match, and it is not a control —
     the 40px well holding the source's glyph at the head of the page, an
     `aria-hidden` span beside the name. It is deliberately the Integrations
     TILE's own recipe, so the card you clicked and the page it opens read as
     the same object; giving it a button's face would make the identity of the
     page look pressable. Everything on this page that IS pressable already
     wears the theme — the connect key is `.btn-primary`, both reconnect keys
     `.btn-secondary btn-sm`, the gear is rowActions' KebabMenu. */
  "components/platform/IntegrationDetail.tsx": 1,
  /* Integrations.tsx REJOINED this list on 2026-09-03, and nothing regressed
     — the fixed pattern can see `grid place-items-center`, which is how all
     three of these were spelled. NOT ONE of them is a control; every one is
     an icon well with the press somewhere else:
       1 — the source's mark on each row of the connected table. The ROW is
           the control (`onRowClick` opens that integration's page), so a
           button's face here would draw a second, smaller press inside the
           first, on the element whose only job is to say WHICH source;
       1 — the round glowing tile on each Available card, the recipe the
           workflow cards share. The CARD carries `role="button"` and the
           card's own action row stops the click — the mark is the thing
           being offered, not the offer;
       1 — that same mark repeated inside the connect briefing, where what
           you press is the dialog's confirm key.
     All three are `aria-hidden`. The file's ORIGINAL entry stays closed: the
     "not configured" pill became plain copy on 2026-09-02 and is still copy,
     which is the one finding here that ever was a defect. */
  "components/platform/Integrations.tsx": 3,
  /* MailDraftCard.tsx, 2026-09-03: its whole footer was converted and the one
     that remains is the card's MAIL MARK — a 28px tinted circle holding the
     envelope, decoration that says what kind of card this is. Nothing presses
     it; what a person presses is Send, three inches below.
     The three that went are the interesting half, because this guard could
     see NONE of them: Send and «اتصال» wrote `h-9 min-h-0 px-3 text-xs` /
     `h-9 min-h-0 gap-1.5 px-4 text-sm` ON TOP of `.btn-primary` and
     `.btn-secondary` — invisible BECAUSE the class they re-answer is present
     — and Discard was a bare `tap h-9 rounded-lg` with no centring class to
     match. So the row that decides whether a reply is sent stood at 36px in
     three spellings, next to a platform whose compact control is 34. */
  "components/platform/MailDraftCard.tsx": 1,
  /* MeetingPage.tsx, 2026-09-03: all NINETEEN of its buttons already wear the
     theme — nothing here was converted because nothing here is a control. Its
     six are the shape without the press, and dressing them as buttons would
     offer a press that does not exist:
       4 — a person's initial in a circle (the invitees card, the stage's
           members rail), the avatar idiom a dozen files share;
       2 — an icon well, the mode glyph in the plan's header and the mic on a
           file row: `aria-hidden` spans beside the text that carries the
           meaning. */
  "components/platform/MeetingPage.tsx": 6,
  /* NotificationBell.tsx never appeared on this list and had ONE, converted
     2026-09-03: the bell was a 36px square with the 12px MENU corner,
     standing in the top bar's end cluster between a theme toggle at `.btn
     btn-icon` (28, 8px) and a clock and locale pair at `.btn btn-sm` (34,
     8px) — one row, three shapes, on the chrome every screen carries. It
     was invisible here until the pattern learned `grid place-items-center`,
     which is exactly why a short list is not the same as a converted one.
     Its glyph came to 16 with it, the size the toggle beside it draws: two
     icon buttons sharing a box and disagreeing about the icon inside it is
     the same complaint one level down.
     The unread BADGE is neither counted nor converted — a count in a circle
     is a badge, and it is spelled `h-[18px]`, an arbitrary value this
     guard's fixed-height pattern does not read. No entry rather than a
     zero: a zero row reads as coverage and is a hole. */
  /* TaskBoard.tsx LEFT this list on 2026-09-03 (the conversion this guard was
     supposed to have been driving): its entry said ONE and the fixed pattern
     found EIGHT — the view/priority chips, the two toolbar toggles, the two
     ends of the topic strip, the tone swatch, the column's archive button and
     the foot-of-column add row. Six of the eight were invisible to the old
     pattern for the two reasons that hid a hundred others: a template-literal
     className (every chip on that board has an active state) and a
     grid-centred box. They wear `.btn btn-sm` and `.btn btn-icon` now, in the
     spelling Meetings.tsx already used — the two boards render the same
     toolbar and the same topic strip, so a difference between them is a
     difference a person can see by switching tabs. Worth recording: the two
     rows sat EIGHT PIXELS apart (h-9/rounded-xl above, h-8/rounded-lg below)
     with an already-converted `.btn btn-sm` chip between them, which is what
     "ten different developers" looks like inside one file. Three more went
     with them that this guard still cannot count — a bare `rounded` on a 24px
     icon button and the column composer's h-7 footer pair, which spell no
     centring class — because converting only what a check can see is how a
     file ends up half-converted and looking it. */
  /* tasks/TaskDetail.tsx, 2026-09-03: six matches, FOUR of them controls and
     now the theme's — the close button (which stood at 36px/14px next to the
     kebab, and rowActions renders that kebab as `.btn btn-icon` at 28px/8px:
     two adjacent elements, two shapes, in the product's own top bar), the
     mark-done chip beside an already-converted meeting chip, the square that
     adds a checklist line, and the priority row, which is now the SAME
     control the new-task dialog offers for the same choice. Two more went
     with them that this guard cannot count — the comments/history segmented
     tabs (globals names h34 as the segmented-tab case by name) and the post
     button — because converting only what a check can see is how a file ends
     up half-converted and looking it.
     What REMAINS is two AVATARS: an initial in a circle on a comment and on
     a history line, `aria-hidden` spans with nothing to press. */
  "components/platform/tasks/TaskDetail.tsx": 2,
  /* tasks/TaskDialogs.tsx, 2026-09-03: six matches, three of them controls —
     the new-task close, the add-assignee button (now square at the exact
     height of the `.btn btn-sm` assignee chips it stands in a row with, its
     dashed edge kept because that is what says "add another"), and the
     priority radios. SEVEN more the guard cannot see went too: the label
     editor's close, which had NO box while its sibling dialog's had a 36px
     one; both footers, where a 40px pair stood beside a `.btn` on the same
     row; the column radios directly above the priority ones, since
     converting one of two radiogroups is worse than converting neither; and
     the label chip welded to its pencil, 32px beside a `.btn btn-sm` new-
     label button at 34 — invisible here because this guard's corner pattern
     reads `rounded-lg` and that pair was spelled `rounded-s-lg`, which is a
     third blind spelling worth knowing about when this list reads as short.
     What REMAINS is two AVATARS and the label editor's COLOUR SWATCH — a
     32px well whose entire content is the colour, chosen by a ring on the
     well itself. `.btn`'s label padding and control height describe a button
     with words in it; a palette dressed that way stops reading as a palette,
     and a wrong conversion is worse than an honest entry. */
  "components/platform/tasks/TaskDialogs.tsx": 3,
  /* tasks/TaskViews.tsx, 2026-09-03: four matches, TWO of them controls and
     now the theme's — the calendar's ‹ › arrows, character for character the
     pair Meetings.tsx wears over the same month grid, because two surfaces
     rendering the same toolbar must not disagree about how it looks. Two more
     went with them from that SAME row that this guard cannot count: «امروز»
     (`.btn-sm`, again Meetings' own) and the ماه|هفته|روز segmented tabs,
     which globals.css names by name as what the 34px size was measured off.
     Converting the two ends of a row and leaving its middle is how a file
     ends up half-converted and looking it.
     What REMAINS is two DATE MARKS: the day number in a month cell and in the
     week strip's header, `<span>`s that wear the accent when the day is
     today. Nothing presses them — in a calendar cell the press is the task
     chip inside it — and a day number dressed as a button offers one that
     does not exist. Meetings.tsx carries the identical mark over its own
     grid, so this is a shared idiom rather than a stray. */
  "components/platform/tasks/TaskViews.tsx": 2,
  /* TopBar.tsx LEFT this list on 2026-09-02 (audit finding): its one entry
     was the clock's hand-rolled h-9/12px box, which wears `.btn btn-sm` now.
     The same pass converted the theme toggle to `.btn-icon` and the fa/en
     segments to `.btn-sm` — neither of which this guard could see (a grid,
     and a template-literal className), which is worth remembering when this
     list reads as short. The entry is deleted rather than zeroed: a zero row
     reads as coverage and is a hole. */
  /* WorkflowBuilder.tsx, 2026-09-03: six matches, five of them controls — the
     `+` that inserts a step ON the connector line, the ✕, and the puzzle's own
     up/down/remove — all five `.btn btn-icon` now. Seven more went in the same
     pass that this guard cannot count: four `rounded-full` toggle lozenges —
     the shape globals.css names as the one biggest reason our screens did not
     match the reference — and three `h-9 min-h-0` sizes written ON TOP of
     `.btn`, which is a hand-rolled control wearing the very class that exists
     to prevent one, and is invisible here BECAUSE the class it re-answers is
     present. Converting only what a check can see is how a file ends up
     half-converted and looking it: this modal had five button heights in it
     (38, 36, 34, 28, 28-round) and now has three sizes of one shape.
     THE ONE REMAINING is the step's ORDINAL — the number on the card, which
     nobody presses. It keeps its fixed 24px circle so the numbers line up
     down the column: a `.chip` grows with its digit and would shift the row
     the day a workflow reached ۱۰. */
  "components/platform/WorkflowBuilder.tsx": 1,
  /* WorkflowRunDialog.tsx LEFT this list on 2026-09-03: two matches, and they
     were the two halves of the same problem. The ✕ was a hand-rolled square
     (right size, wrong corner — `rounded-md` is 11px where `.btn-icon` is 8)
     and is the theme's icon button now. The recorded entry was the "not
     configured" sentence dressed as a 36px bordered pill, sized to the
     Connect button beside it: a claim about the PRODUCT reading on screen as
     a disabled control somebody had failed to enable. It is plain copy now —
     the identical finding Integrations.tsx closed the day before, in the
     identical sentence, which is the argument for a worklist over a memory.
     Two went off this guard's books with them: the provider chooser, a
     32px lozenge where a segmented control takes the shape TopBar's fa/en
     pair takes, and the Connect button, `.btn` with `h-9 min-h-0 px-3
     text-xs` bolted on — a restated size, which this guard cannot see
     BECAUSE the class it re-answers is present. */
  "components/platform/WorkflowTile.tsx": 1,
  /* the workflow's identity mark: an `aria-hidden` span with no handler,
     sharing a button's shape and nothing else. What is pressable is the card
     or the header it sits inside; giving 96px of decoration a button's face
     offers a press that goes nowhere. */
  /* meeting/InviteDialog.tsx, 2026-09-03: one match, and it is not a control.
     It is the 28px circle inside each colleague's row, holding their initial
     or the tick that says they are coming — `aria-hidden`, no handler of its
     own, because the whole ROW is the button. Dressing it as one would draw a
     second, smaller press inside the first, on the element whose only job is
     to say WHO. Everything pressable on this dialog already wears the theme:
     the ✕ is `.btn btn-icon`, the add key `.btn`, the guest link `.btn-sm`. */
  "components/platform/meeting/InviteDialog.tsx": 1,
  /* MeetingAssistant.tsx, 2026-09-03: its one visible control is converted —
     the send key was a 40px/16px-corner square by hand where the meeting
     page's own two composers, same 14px glyph on the same accent, are
     `btn … px-3`. The four suggested questions went with it (`.btn-sm`, like
     the new-chat button eight lines above them), and this guard could not see
     those at all — no centring class, so they never counted.
     The three that remain are one thing at three sizes: the assistant's own
     identity mark in the header, beside the greeting and beside every answer.
     `aria-hidden` spans, and the one shape on this surface that must NOT read
     as pressable — pressing the agent's face does nothing. */
  "components/platform/meeting/MeetingAssistant.tsx": 3,
  /* meeting/Minutes.tsx, 2026-09-03: three matches and NOT ONE of them is a
     control — all six of the document's buttons (re-run, approve, sign,
     finalize, Word, PDF) already wear `.btn`. What the fixed pattern found is
     the document's own furniture:
       1 — the ordinal beside each decision. It is a `.badge-num` span, which
           ALREADY centres itself, so deleting the redundant `grid
           place-items-center` would take the match away without moving a
           pixel — hiding from the check rather than answering it, and the
           reason this entry says three instead of two;
       1 — the dashed 80px SIGNATURE STAMP, the empty ring a signature has not
           landed in yet. A button's face on it promises that pressing it
           signs; the thing that actually signs is the key in the rail;
       1 — the tick on each status-rail step, `aria-hidden` beside its label.
     A wrong conversion is worse than an honest entry. */
  "components/platform/meeting/Minutes.tsx": 3,
  /* meeting/Review.tsx, 2026-09-03: five matches, ONE of them a control and
     now the theme's — the audio bar's play key, which stood 40px and ROUND an
     inch from the ×speed key's `.btn btn-sm`: two transport keys, one bar, two
     shapes, the platform's complaint at its smallest possible scale. It takes
     `.btn-sm`'s height and is squared by a width, so it matches the key it
     shares the row with; the file carries the rest of the reasoning. This is
     the SECOND instance of that finding — calls/[id]'s player closed the same
     one on its own play/stop pair the day before, which is the argument for a
     worklist over a memory.
     The four that remain are the shape without the press, every one an
     `aria-hidden` span:
       1 — the 64px ring the processing card spins while the worker runs;
       1 — the numbered step marker in that card's ladder;
       1 — the icon well over "the audio recorded, no speech was found";
       1 — the speaker's initial on every transcript line, the avatar idiom a
           dozen files share.
     Not counted, and deliberately not converted either: the transcript
     timestamp. It is a bare text control with no geometry at all, so it is
     nothing this guard is about — and a 34px bordered box on every line would
     rebuild the panel's density to satisfy a rule about shapes it has none
     of. */
  "components/platform/meeting/Review.tsx": 4,
  /* Room.tsx's one remaining match is NOT a control: the icon well the video
     room waits inside while its token is minted — a span, aria-hidden, with
     nothing to press. Its two real controls (the copy-link button) and the
     stage around it wear `.btn btn-sm` now; this is the shape a well shares
     with a button, not a button. */
  "components/platform/meeting/Room.tsx": 1,
  /* Stage.tsx LEFT this list on 2026-09-03: all three were controls and all
     three are converted — the mode chips (a segmented tab is what `.btn-sm`
     was measured off), the fullscreen grip (`.btn btn-icon`) and the PDF
     loader, which had invented a THIRD geometry inside a component already
     carrying two. Whiteboard.tsx never appeared here and had SIX, every one
     of them a button: the old pattern could not see `grid place-items-center`
     or a template-literal className, which is the whole reason this list read
     as short. Deleted rather than zeroed — a zero row reads as coverage. */
  /* rowActions.tsx, 2026-09-03: its one match is `SelectMenu variant="round"`
     — the 40px circle the recorder's mic and source pickers wear — and
     Recorder.tsx's entry above has already ruled on the set it belongs to.
     ONE line here stands for BOTH pickers, so converting it puts a single
     8px-cornered rectangle into a row of circles around the record button:
     the "ten different developers" symptom inside one row, on the product's
     centrepiece. Redrawing that transport is a decision with the user.
     Two more this guard cannot count are named in the file beside their
     reasons. The option-level ✕ keeps its hand-rolled 24px square (a bare
     `rounded` is a third blind spelling, worth knowing when this count reads
     as one): `.btn btn-icon` would compose `.tap` and throw a 44px hit area
     around a control that is `opacity-0` until hover — invisible on every
     touch device, where there is no hover — and what it does is DELETE. And
     the call-bar tile's `h-[clamp(…)]` is a viewport-scaled face rather than
     a size the theme names. Everything else in the file already IS the theme:
     IconAction and the confirm dialog's ✕ are `.btn btn-icon`, the dialog's
     footer is the `.btn-*` family, and the two `.input` triggers now say the
     height once. */
  "components/rowActions.tsx": 1,
  "components/scaffold/SectionMenu.tsx": 1,
};

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A control's geometry written by hand: a fixed height AND a corner AND a box
 * that centres its contents. Deliberately all three — `h-8` alone is a spacing
 * utility, `rounded-lg` alone is a card, and a guard that fires on either
 * would be the false-positive factory that gets a check muted inside a week.
 *
 * TWO SPELLINGS OF "CENTRED BOX", and the second one is why this guard spent
 * months reporting a platform that was 92% converted while it was 8%
 * converted. `flex items-center` was counted; `grid place-items-center` — the
 * same control, the same three utilities, written the other way — was not, and
 * that is how EIGHTY of them accumulated. The user's directive is about what
 * the controls LOOK like, and a grid-centred 36px box with a 16px corner looks
 * exactly like a flex-centred one.
 *
 * TWO SPELLINGS OF "className", same story. `className="…"` was read;
 * `className={`…`}` — the form every control with a conditional state uses —
 * was not, because the old pattern required a quote immediately after the `=`.
 * Thirty more. A control is not less hand-rolled for having an active state.
 *
 * The interpolations are kept rather than blanked: `${on ? "rounded-full" : ""}`
 * puts a real corner on a real element, and blanking it would let any geometry
 * hide behind a ternary — which is the same hole one level in.
 */
function classAttributes(code: string): string[] {
  const out: string[] = [];
  /* the quoted form: className="…" or className='…' */
  for (const m of code.matchAll(/className=(["'])([^"']{0,400}?)\1/g)) out.push(m[2]!);
  /* the template form: className={`…`}, read to the closing backtick.
     `${` and `}` become spaces so the branches read as plain class words. */
  for (const m of code.matchAll(/className=\{`([^`]{0,600}?)`/g)) {
    out.push(m[1]!.replace(/\$\{/g, " ").replace(/[}"']/g, " "));
  }
  return out;
}

function handRolled(code: string): number {
  let n = 0;
  for (const cls of classAttributes(code)) {
    if (/\bbtn\b|\bbtn-/.test(cls)) continue;
    /*
     * A FIXED height — not `min-h-` or `max-h-`, which are the utilities a
     * flexible box uses to STAY flexible. `\b` holds before the `h` in
     * `min-h-0`, so the obvious pattern fired on the one class that means the
     * opposite of a hand-rolled height, and it reported a card the moment it
     * was made more flexible rather than less.
     */
    if (!/(?<![\w-])h-\d+(?:\.\d+)?\b/.test(cls)) continue;
    if (!/\brounded-(?:md|lg|xl|2xl|full)\b/.test(cls)) continue;
    const flexCentred = /\b(?:inline-)?flex\b/.test(cls) && cls.includes("items-center");
    const gridCentred = /\b(?:inline-)?grid\b/.test(cls) && cls.includes("place-items-center");
    if (!flexCentred && !gridCentred) continue;
    n += 1;
  }
  return n;
}

describe("controls share one shape", () => {
  it("has something to check — .btn is what most of the product already uses", () => {
    let users = 0;
    for (const file of sources(SRC)) {
      if (/\bbtn(?:-\w+)?\b/.test(codeOnly(readFileSync(file, "utf8")))) users += 1;
    }
    expect(users).toBeGreaterThan(20);
  });

  it("can answer NO — it sees BOTH spellings of a centred box and BOTH of className", () => {
    /*
     * The negative control, and the reason this guard is worth anything after
     * 2026-09-03. For months it reported ten hand-rolled controls; there were
     * about a hundred and twenty. It was not lying about what it measured — it
     * was measuring one spelling of two, twice over, and "no hits" reads
     * identically whether the tree is clean or the pattern is blind.
     *
     * So each spelling is asserted against a string that MUST count, and
     * against near-misses that must not. A guard that can only confirm what it
     * already finds cannot fail for its own reason.
     */
    const flexQuoted = '<b className="tap flex h-9 w-9 items-center justify-center rounded-xl" />';
    const gridQuoted = '<b className="tap grid h-9 w-9 place-items-center rounded-xl" />';
    const flexTemplate = '<b className={`tap flex h-9 items-center rounded-xl ${on ? "bg-accent" : ""}`} />';
    const gridTemplate = '<b className={`grid h-7 w-7 place-items-center rounded-md ${on ? "x" : "y"}`} />';
    /* the corner hidden in a ternary: blanking interpolations would miss this,
       which is the same hole one level in */
    const cornerInBranch = '<b className={`grid h-9 place-items-center ${on ? "rounded-full" : "rounded-md"}`} />';
    for (const [name, code] of Object.entries({
      flexQuoted, gridQuoted, flexTemplate, gridTemplate, cornerInBranch,
    })) {
      expect(handRolled(code), `${name} must count as hand-rolled`).toBe(1);
    }

    /* and what it must NOT claim */
    expect(handRolled('<b className="btn btn-icon border border-border" />')).toBe(0);
    expect(handRolled('<b className={`btn btn-sm ${on ? "bg-accent" : ""}`} />')).toBe(0);
    /* a card: a corner and a height, but nothing centring a control's contents */
    expect(handRolled('<b className="h-9 rounded-xl border border-border" />')).toBe(0);
    /* a flexible row: min-h- is the utility that means the OPPOSITE of a
       hand-rolled height, and it once fired here */
    expect(handRolled('<b className="flex min-h-0 items-center rounded-xl" />')).toBe(0);
    /* spacing alone, and a corner alone */
    expect(handRolled('<b className="flex h-9 items-center" />')).toBe(0);
    expect(handRolled('<b className="grid place-items-center rounded-xl" />')).toBe(0);
  });

  it("no file hand-rolls MORE button geometry than its recorded count", () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\/]/).includes("ui")) continue; // shadcn source owns its own variants
      const rel = relative(SRC, file).split("\\").join("/");
      const found = handRolled(codeOnly(readFileSync(file, "utf8")));
      const allowed = REMAINING[rel] ?? 0;
      if (found > allowed) wrong.push(`${rel}: ${found} hand-rolled, ${allowed} recorded`);
      if (found < allowed) wrong.push(`${rel}: ${found} hand-rolled but ${allowed} recorded — lower the number`);
    }
    expect(
      wrong,
      "use .btn / .btn-sm / .btn-icon, or update the worklist:\n" + wrong.join("\n"),
    ).toEqual([]);
  });
});
