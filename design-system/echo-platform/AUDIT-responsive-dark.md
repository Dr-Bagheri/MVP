# Responsive + dark-theme audit — findings

**Auditor:** Front-end 2 · **Date:** 2026-08-13 · **Build:** dev server on :3100, fixtures (Phase A)

Written for the **milestone-4 dark-first design pass** (see `docs/PLATFORM-BRIEF.md`).
The NeurAI hub is dark-first, so §2 is the part that carries forward: it is a list of
places where the current light-first token set does not survive being inverted.

> **The pattern to carry into the new palette (steward-directed):** every dark failure below
> is a **pairing**, not a bad token. In all four cases both values are individually
> defensible and were never checked against each other — which is why a per-token review
> passes all of them and why they survived to here. Whatever palette milestone 4 lands on,
> the cheap insurance is a checked list of foreground/background **pairs**. The harness in
> §0 computes those ratios and can be pointed at any page.

Per the steward's scope ruling, the **shell is out of scope** (mobile nav is on hold
pending the platform restructure). §4 records shell measurements only because they
gate whether the content surfaces can be measured at all.

---

## 0. Method, and what it is worth

A harness (`window.__audit`) measured, per screen and theme:

- **overflow** — any element in `<main>` whose `scrollWidth` exceeds its `clientWidth`,
  *excluding* deliberate `overflow-x-auto` scrollers. So a table that scrolls inside its
  own box is not reported; a table that is silently clipped is.
- **touch** — every `button`/`a`/`select`/`input` in `<main>` under 44px tall.
- **contrast** — computed text colour against the first opaque ancestor background,
  WCAG relative-luminance ratio, flagged under 4.5:1 (3:1 for large text).

**Correction to the contrast method, found while verifying the fixes.** The original harness
walked up to the first *opaque* ancestor and ignored translucent layers in between. Chip
tones are `bg-info/15`, `bg-success/15` and so on — a 15% tint of the text colour itself —
so for every chip the harness measured against the card behind the tint rather than against
what is actually rendered. Numbers below are re-taken with proper alpha compositing (each
translucent layer composited onto the one beneath). Two consequences:

- `--accent` chips use **opaque** `--accent-soft`, so §2.2's 4.42 was always correct.
- `--info`/`--success`/`--warning`/`--danger` chips are tinted, so §2.3's original 4.1/3.74
  were approximations. They were failures either way, but the composited figure is the real
  one and is what §2.3 now records.

**Two ways to get this wrong, and both happened — independently, from opposite directions.**
The fix's author measured `ratio(--info, --bg)`: the raw token against the page background.
This audit measured the first *opaque* ancestor. Neither is the rendered pair, because the
text sits on `bg-info/15` — a tint **of itself** — over the card:

| method | light ratio | what it actually compared |
|---|---|---|
| raw token vs `--bg` | 7.23 | two values from the stylesheet, never composited on screen |
| first opaque ancestor | 4.10 | the card *behind* the tint |
| **composited (correct)** | **5.95** | what a user's eye receives |

Re-measured independently by both parties afterwards: **5.95 light, 6.32/6.33 dark** — exact
agreement in light, rounding apart in dark. Both figures pass, so no conclusion moves; the
point is that *two people checking the same fix produced two different wrong numbers, one
optimistic and one pessimistic, and neither was the pair on screen.*

The first row is the more dangerous and the one milestone 4 will be most tempted by: when
you have just edited two hex values, comparing **those two values** is the obvious check, it
requires no page, and it flatters the change. **A token pair is not a rendered pair.** Any
tint, any overlay, any `/15` between them means the ratio you want is a composite — so
sample the page, not the palette.

**One caveat on the numbers, and it is the reason this section exists.** Partway through,
the harness reported a clean sweep on three screens in a row. It was measuring a
**500 error page** — empty DOM, no elements, therefore no violations, therefore a perfect
score. The cause was unrelated (a BOM in `web/package.json`, fixed and reported), but the
lesson is that an audit tool's silence is indistinguishable from success unless it is made
to prove it looked at something.

The harness now refuses to report on a page that did not render (`INVALID` instead of a
result) and returns an element count with every pass, and **the guard was verified to fire
on a synthetic 500 before any result below was trusted**. Every finding here carries a
`rendered` count above 50. Results gathered before the guard existed were re-taken.

**Coverage, and the honest list of what is missing.** Audited at 375 in **both themes**:
`calls`, `calls/[id]`, `capture`, `admin`, `connectors`, `skills`, `search` (with a real
query run, so the results surface is included), `profile`, `sign-in`. Plus `calls` at 768
and 1024.

Also audited: `pending`, `sign-up`, and **`en` at 375** (`calls` and `sign-up`, both themes)
— the locale where `dir` flips. `en` showed no RTL-mirror defects: no page overflow, nothing
positioned off-viewport outside a deliberate scroller, and the same findings as `fa`.
`pending` is clean in both themes.

**Coverage is now complete for the audit as scoped.** The remaining gaps are deliberate:
`en` was spot-checked at 375 rather than swept across every screen (the layout is
locale-independent and `fa` is the primary), and 768/1024 were measured only where a
finding at 375 needed a resolution point.

---

## 1. Responsive — content surfaces

### 1.1 The calls table was clipped below ~1024px — FIXED, verified

> **Resolved by Front-end 1 while this audit was running.** Re-measured at 375: the table
> now sits in an `overflow-x-auto` wrapper (client 333, scroll 882), `scrollLeft` moves, and
> the page itself does not overflow. The record below stands because the *measurement
> lesson* outlives the bug.

The steward's brief says "the calls list must work on a phone". It did not.

| viewport | main width | table needs | result |
|---|---|---|---|
| 375 | 333 | 531 | **198px of every row unreachable** |
| 768 | 502 | 531 | **29px clipped** |
| 1024 | 800 | 531 | fits |

`div.card.!p-0` on the calls list wraps the table with **no scroller**, so the overflow is
clipped rather than scrollable — and because the card clips it, `document.scrollWidth`
stays equal to the viewport. **The page reports no horizontal overflow while a third of the
table is unreachable.** A whole-page overflow check would call this screen clean.

Compare `connectors`, which puts its tables in `overflow-x-auto` wrappers and measures clean
at 375: the table scrolls inside its own box and the page does not. That is the pattern the
calls list needs — or a card layout under `md`, which is the better answer for a phone.

### 1.2 Touch targets — the 44px rule is written down and then cancelled everywhere

`.btn` in `globals.css` declares `min-h-[44px]`. Nearly every call site overrides it:

```
btn-primary h-10 min-h-0   → 40px    btn-secondary h-9 min-h-0 → 36px
btn-secondary h-8 min-h-0  → 32px    chip-as-button            → 24px
input.h-4.w-4 (checkbox)   → 16px, no padded hit area
```

Counts at 375, content area only: `admin` 13 · `connectors` 8 · `calls` 7 · `skills` 5 ·
`search` 5 · `calls/[id]` 4 · `capture` 2 · `profile` 1 · `sign-in` 1.

Worst individual cases:
- **`search` result links: 20px tall** — and they are the entire point of the screen. The
  worst offender found, and not a button, so a button-only sweep would miss it.
- **`calls/[id]` play button: 34×40px** — the primary control of the screen.
- **`calls` scope toggles («خصوصی» / «سازمان»): 24px** — and they mutate call visibility.
- **`admin` role selects and accept/reject: 36px**; the model allow-list checkboxes are 16px.
- **`connectors` revoke buttons: 32px** — mine; destructive and the smallest thing in the row.

**Harness limitation, stated so nobody reads a clean result as proof:** this counts
`button`/`a`/`select`/`input` only. Click handlers on `span`/`div` — notably the
click-a-word seek targets on `calls/[id]` — are **not** measured, and individual words are
certainly under 44px. Seek-by-word may simply not be a phone interaction; that is a design
call, not a measurement.

This is a house-style decision, not scattered mistakes: the density pass (verdict item 4)
tightened rows, and `min-h-0` is how it was done. It reads correctly with a mouse at 1440
and fails the 44px rule everywhere with a finger. **The fix is a decision, not a patch** —
either the dense sizes get a padded hit area under `md`, or `.btn`'s `min-h-[44px]` should
stop claiming something the system does not do.

### 1.3 Flex rows crush text before they wrap

`admin` at 375: the deleted-items row squeezes the call title to **41px against a 64px
minimum** (`span.min-w-0.flex-1.text-sm`) because the chip and restore button take priority
in a `flex-wrap` row. `min-w-0` lets it shrink to nothing rather than wrapping. Same shape
as the sibling rows on that screen.

---

## 2. Dark theme — token gaps (for the milestone-4 design language)

**These are the findings that carry forward.** The current system is light-first with a
ruled dark mode; the hub is dark-first, so each of these becomes a foundation issue.

### 2.1 The focus ring's offset was hard white in dark — FIXED, verified

> **Closed.** Re-measured on a `:focus-visible` control in both themes: the offset now
> matches the page background exactly — `rgb(2,6,23)` in dark, `rgb(248,250,252)` in light,
> ring `--accent` in both. No white halo. `--tw-ring-offset-color` is wired.

```css
:focus-visible {
  @apply outline-none ring-2 ring-accent ring-offset-2;
  ring-offset-color: rgb(var(--bg));   /* ← does nothing */
}
```

`ring-offset-color` **is not a CSS property.** It is a Tailwind utility name; the ring is
rendered from `var(--tw-ring-offset-color)`, which nothing in the codebase sets, so it keeps
its default `#fff`. Measured on a keyboard-focused button:

```
dark:  rgb(255,255,255) 0 0 0 2px, rgb(56,189,248) 0 0 0 4px
light: rgb(255,255,255) 0 0 0 2px, rgb(3,105,161)  0 0 0 4px
```

In light the white offset sits on `#F8FAFC` and is invisible — which is exactly why this
survived. In dark it is a **white halo on a near-black page**. Fix is one line:
`--tw-ring-offset-color: rgb(var(--bg));`.

The rings themselves are correct: `:focus-visible` matches on keyboard focus in both themes,
and focus is never removed.

### 2.2 `--accent` on `--accent-soft` fails AA in dark, passes in light

**4.42:1, needs 4.5.** `rgb(56,189,248)` on `rgb(12,74,110)`. Affects every accent chip —
scope chips on `calls`, the version selector on `calls/[id]`, the assistant-allowed chip on
`connectors`, the suggested-model marker on `admin`. It is the single most repeated dark
finding in this audit, and it is a **pair** problem: both tokens are individually reasonable
and their combination is not. The light pair (`3,105,161` on `224,242,254`) passes
comfortably, which is why the dark half was never caught.

### 2.3 `--info` failed AA in light — FIXED, verified

> **Closed.** `#0284C7` → `#075985`. Re-measured with compositing over the real 15% tint:
> **5.95:1 light, 6.32:1 dark**. Both pass. Confirmed independently by both the fix's author
> and this audit, after both had first produced different wrong numbers for it — see §0.

**4.1:1 on `#FFF`, 3.74:1 on `--surface-2`** — `rgb(2,132,199)`. Affects `StatusChip` for
every in-flight state (`processing`, `linking`, `summarizing`, `recording`) and the part
timer on `capture`. Dark's `--info` (`56,189,248`) is fine.

Worth noting against the design-system rule that status is never carried by colour alone —
that rule is honoured (every chip is dot + label), so this is a legibility failure rather
than a comprehension one. It still fails AA.

### 2.4 The Echo mark on `--accent` failed AA in BOTH themes on auth — FIXED, verified

> **Closed by an `--on-accent` token**, as directed rather than by two local patches.
> Re-measured on `/fa/sign-in`: **5.93:1 light, 8.33:1 dark** (was 3.40 / 1.96). The
> foreground no longer tracks `--fg` — it is `rgb(15,23,42)` on the bright dark accent and
> white on the deep light one, i.e. chosen *for the surface* rather than for the theme.
> Same numbers on the two `AppShell` badges.
>
> **The fix's own first attempt is the most instructive part of this entry** — see §6.

Two variants of the same mistake, and the second is worse:

| where | foreground | light | dark |
|---|---|---|---|
| `AppShell` sidebar + mobile badges | `text-white` (fixed) | pass | **2.14** |
| `sign-in` / `sign-up` mark | inherits `--fg` (flips) | **3.40** | **1.96** |

The auth variant is the instructive one. It sets no foreground, so it inherits `--fg` — and
`--fg` and `--accent` **flip lightness in the same direction**: in light, near-black `#020617`
sits on mid-blue `#0369A1` (dark on dark); in dark, near-white `#F1F5F9` sits on bright
`#38BDF8` (light on light). A token pair that tracks the theme *together* collides in every
theme. It has never passed, in either mode, on the first screen a customer sees.

This is the sharpest instance of the light-first problem, and the mechanism is worth stating
because milestone 4 will hit it repeatedly: **`--accent` changes role between themes.** In
light (`#0369A1`) it is a dark ink that white sits on comfortably. In dark (`#38BDF8`) it is
a bright *surface* — correct for its main job, being legible **as text on dark backgrounds**
at ≥4.5:1. What does not survive is any assumption about what sits *on top of* it.

This is the sharpest instance of the light-first problem, and the mechanism is worth stating
because milestone 4 will hit it repeatedly: **`--accent` changes role between themes.** In
light (`#0369A1`) it is a dark ink that white sits on comfortably. In dark (`#38BDF8`) it is
a bright *surface* — correct for its main job, which is being legible **as text on dark
backgrounds** at ≥4.5:1. What does not survive is the assumption that white can sit on it.
Anything `bg-accent` + `text-white` needs a dark foreground in dark mode, or a separate
`--on-accent` token that flips.

A `--on-accent` pair is the durable fix and the one to carry into the hub, where an accent
tile is the active state on the icon rail — exactly this pattern, on the most-looked-at
element on the page.

### 2.5 Summary table for the design pass

| pair | light | dark | verdict |
|---|---|---|---|
| `--fg` on `--accent` (auth logo mark) | **3.40** | **1.96** | fails BOTH — needs `--on-accent` |
| white on `--accent` (shell logo marks) | pass | **2.14** | fix dark — same token |
| `--accent` on `--accent-soft` | pass | **4.42** | fix dark |
| `--info` on `--surface` / `--surface-2` | **4.1 / 3.74** | pass | fix light |
| ring offset vs page | invisible (lucky) | **white halo** | fix both, one line |
| `--fg-muted` on `--surface` | pass | pass | ok |
| `--success` / `--warning` / `--danger` chips | pass | pass | ok |

The `[data-theme="dark"]` block is a genuine re-derivation rather than an inversion — every
surface and text token was re-picked, and the sidebar does step lighter (`#0F172A` on
`#020617`) as ruled. **The gaps are all in token *pairings*, not in the tokens.** Each of the
four failures above is two individually-defensible values that were never checked against
each other, which is why a per-token review would pass all of them.

---

## 3. Motion and focus

- **`prefers-reduced-motion` is correctly declared** — the media block is present in the
  compiled stylesheet and zeroes `animation-duration`, `animation-iteration-count`,
  `transition-duration` and `scroll-behavior` globally. Confirmed present as a live CSSOM
  rule, **not** confirmed under emulation (the browser tool exposes no reduced-motion
  override); a real check needs Playwright's `reducedMotion: 'reduce'`.
- **Focus visibility passes** in both themes, with the offset caveat in §2.1.

---

## 4. Shell — out of scope, recorded because it gates §1

### 4.1 The original squeeze (fixed)

`AssistantPane` was `w-full md:w-[380px]` and a **flex sibling of `<main>`**, so it took its
width out of the content area:

| viewport | main, pane open | main, pane closed |
|---|---|---|
| 375 | **40px** | 375px |
| 768 | **164px** | 544px |

Fixed by Front-end 1: the pane is now `fixed inset-0 z-40` below `md`, docked above it.
Main measures a full 375px at mobile again.

### 4.2 …and the fix's replacement — FIXED, verified by hit-test

> **Closed.** Re-checked at 375 with no manual dismissal: the pane **does not render at all**
> below `md`, and `elementFromPoint` at the centre of a real call link returns the link.
> Content is reachable. Desktop still docks. The implementation is deliberately narrow —
> starts closed, opens itself from `md` up — so it stops the pane covering content without
> deciding drawer-vs-sheet-vs-docked, which stays with the held mobile-nav proposal.

**What it was:** an opaque full-viewport overlay, open by default. Measured on a fresh load
at 375: `aside.fixed.inset-0.z-40`, **375×812**, background `rgb(15,23,42)`,
`z-index: 40`. `elementFromPoint` at the centre of any content control returned the aside,
not the control. **Every screen's content was unreachable at mobile until the user found and
pressed «بستن».** Recoverable — there was a close button — but the app opened onto the
assistant with the product hidden behind it.

**This is worth more than the defect itself.** The fix moved the metric in the right
direction and the app the wrong way:

| | before | after |
|---|---|---|
| `main` width at 375 | 40px | **375px** ✓ |
| page overflows horizontally | no | no ✓ |
| content actually reachable | yes (40px of it) | **no** ✗ |

Every measurement I had proposed for this bug — main width, page overflow — **improved**,
and the screen went from cramped to unusable. The audit in §1 was re-run against the fix and
would have certified it: the numbers are better. It was caught only by hit-testing a control
rather than measuring a box, after a `.tap` check failed for what turned out to be this
reason and not the one it looked like.

The generalisable form, and the third instance of this shape in one session (see §0 and the
CLAUDE.md BOM note): **a proxy metric confirms the fix it was chosen for, not the property it
was standing in for.** Layout audits measure boxes; users press things. Hit-testing is the
measurement that cannot be satisfied by an invisible layer, and it should be the default for
any control this audit calls compliant.

Front-end 1 has flagged their change as a squeeze fix rather than a mobile pattern, and the
pattern belongs to the held mobile-nav proposal. Recording it as **open**, with the note that
`open` defaulting to `true` is the part that makes it a blocker rather than a rough edge.

### 4.3 `.tap` silently does nothing on replaced elements

The `.tap` utility grows the hit area with a centred 44×44 `::after`. **`<select>` and
`<input type=checkbox>` are replaced elements and render no pseudo-element** — verified:
computed `content` on a `.tap` select is `none`, and its hit area stayed the visual 36px.

The failure is silent, which is the problem: the class is present, the intent reads as
satisfied, and the target is unchanged. Two workarounds are in use in `connectors/`:

- **`<select>`** — grow it for real: `h-11 md:h-9`. Same bargain `.tap` strikes, paid in
  layout instead of a pseudo-element.
- **`<input type=checkbox>`** — put `.tap` on the wrapping `<label>`, which is not replaced.
  The label was already the wide target (its text toggles the box); what it lacked was
  height, 20px. Verified: hit extends 16px above centre, correctly misses at 30px.

Worth either teaching `.tap` to refuse replaced elements loudly, or documenting the two
substitutes beside it.

---

## 6. The pattern this audit actually found

Four of the defects above are the same bug wearing different clothes, and three of them are
in the stylesheet layer. **An artifact that is present, reads as satisfied, and does
nothing.** Not a typo, not a missing line — a line that is *there*, that a reviewer's eye
confirms, and that has no effect:

| artifact | reads as | actually |
|---|---|---|
| `ring-offset-color: rgb(var(--bg))` | the offset follows the theme | not a CSS property; Tailwind renders from `--tw-ring-offset-color`. Inert since written |
| `class="tap"` on `<select>` / `<input type=checkbox>` | hit area is 44px | replaced elements render no `::after`. Class present, target unchanged |
| `class="text-on-accent"` with no `on-accent` in `tailwind.config.ts` | the mark uses the new token | class emits nothing; the mark inherited `--fg` and got **worse** (1.96 vs the 2.14 it replaced) while the markup read as fixed |
| any contrast check over a `bg-*/15` tint | measured against what's rendered | **two** wrong answers, reached independently — raw token vs `--bg` (7.23) and first-opaque-ancestor (4.10). Neither pair is on screen; the composite is 5.95 (§0) |

The shared property is that **the failure is invisible at the place you would look for it.**
Reading the JSX shows `tap`. Reading the CSS shows `ring-offset-color`. Reading the diff
shows `text-on-accent`. Every one of them requires leaving the source and asking the
*rendered* artifact what it actually is — computed `content`, computed `box-shadow`,
`elementFromPoint`, composited background.

The third row is the sharpest, because it is the failure mode of a **fix**: the token was
right, the diagnosis was right, the call sites were right, and the result was worse than the
bug. A fix that reads as applied is more dangerous than the defect it targets, because
nobody re-measures a line they just watched land.

The generalisation, which is the same one §4.2 reaches from the layout side: **verify the
rendered artifact, not the source that should have produced it.** In CSS that means computed
values; in layout it means hit-testing. In both cases the cheap check is the one the failure
mode cannot satisfy.

### 6.2 The artefact that outlives its own retracted claim

Also not a fifth row, and for a precise reason: **this one is not inert.** Every entry in the
table above does nothing. This one works perfectly — on the basis of a premise that was
withdrawn.

Two screens once told users the model list was filtered to tool-capable models, and filtered
on an invented `tool_capable` field. Nothing filters on tool support; the catalogue carries
no such field. The **sentence** was retracted and removed from both screens. The **control**
— `disabled={!model.tool_capable}` on the allow-list checkbox — survived it by weeks, and
was still presenting enforcement that does not exist when the surface was re-homed.

Its author's account of why is the useful part:

> I removed the sentence and left the control, because the sentence was the thing I'd
> written and the control read as mechanism.

That is the generalisation: **when a claim is retracted, the prose gets retracted and the
mechanism survives.** The prose is obviously the claim; the mechanism looks like
implementation, and implementation reads as neutral. So a retraction that greps for the
words is a retraction that leaves the behaviour.

It shares one property with §6 — the failure is invisible at the place you would look, since
`disabled={...}` reads as a rule rather than as an assertion — but the fix is different. The
§6 rows need the *rendered artifact* checked. This one needs the question: **when we withdrew
that claim, what else was built on it?**

Related discipline, from the same exchange: a first attempt at asserting the `Call` wire
shape only checked that *some* fields overlapped, so it passed trivially and would have
passed through any drift. It was deleted rather than kept, with a note that the honest
assertion is red today and lands with the migration. **A weak green is worse than an absent
check** — it occupies the slot where a real one would go, and it reports success.

### 6.1 A related shape with a different mechanism — where attention goes

Recorded separately rather than as a fifth row above, because it is **not** the same bug.
The four rows share one mechanism: the source says X and the rendered artifact does Y. This
one shares only the symptom.

Soft delete and restore broke together, from one root cause — a row policy hides a call from
its own owner the moment it is marked deleted. The two symptoms had very different volumes:

| | UI today | how it fails |
|---|---|---|
| **delete** | none — zero call sites in any screen | a visible **404** |
| **restore** | a button, on the admin screen | matches zero rows, **raises nothing at any layer** |

**The failure you could see wasn't reachable; the failure you couldn't see was the one a user
could press.** Both reports led with delete, because a 404 is something to point at — and
triage follows the noise rather than the exposure. Nothing about the loud one was wrong; it
simply consumed the attention that the silent sibling needed.

The restore button also had a second layer of quiet: it renders only for rows with
`deleted_at`, and against a live engine no such rows could exist, so the section would render
empty, the button would never appear, and the untested control would pass every smoke test by
never being drawn.

So the lesson is about triage, not verification: **when one cause produces two symptoms, rank
them by what a user can reach, not by which one is easier to see.** The check that would have
caught it is not a better instrument — it is asking, of every known bug, *which of its
symptoms already has a control in front of a user?*

## 5. Recommended order

**Everything this audit raised is now closed except one deferral.**

| item | state |
|---|---|
| §1.1 calls table clipped below 1024 | **fixed**, re-measured (333px scroller over an 882px table, page clean) |
| §1.2 touch targets under 44px | **ruled + fixed** — `.tap` utility; `.btn` composes it, `connectors/` applied, hit-proven at exactly 44 |
| §2.1 ring offset white in dark | **fixed**, offset matches page bg in both themes |
| §2.3 `--info` failing in light | **fixed**, 5.95 light / 6.32 dark composited |
| §2.4 Echo mark on `--accent` | **fixed** via `--on-accent`, 5.93 light / 8.33 dark |
| §4.1 pane squeezing main | fixed, then superseded by §4.2 |
| §4.2 pane covering content | **fixed**, hit-tested at 375 |
| §4.3 `.tap` on replaced elements | **documented** in `globals.css` with both substitutes |
| §2.2 `--accent` on `--accent-soft` in dark (4.42) | **deferred** to the milestone-4 palette by steward ruling — both tokens move anyway |

**The one open item is the deferral**, and it is the item most likely to be resolved for free:
the hub's palette re-derivation moves `--accent` and `--accent-soft` regardless. It should be
checked as a **pair** when it does — which is the header note, and §6 is why.

**For milestone 4, in order of what will actually save time:**
1. `--on-accent` already exists and is the pattern for the hub's accent-tile rail — the most
   looked-at element on the new first page sits on exactly this pairing.
2. Check foreground/background **pairs**, not tokens (header note, §2.5 table) — and check
   them **on the page**, not in the palette. Comparing the two hex values you just edited is
   the obvious move, requires no browser, and is wrong wherever a tint sits between them
   (§0). This is the check the palette re-derivation is most likely to reach for.
3. Verify rendered artifacts, not source (§6) — computed values and hit-tests.
4. The dense-vs-touch bargain is settled: visuals keep their size, hit areas grow below `md`.
   `.tap` is the mechanism, and §4.3 lists where it silently doesn't work.

**One structural note for milestone 4.** Every dark failure here is a *pairing* that no
per-token review would catch, and all four were invisible at 1440/light — the only
configuration the system has been held to. A dark-first system inverts that exposure: the
pairings that go unchecked will be the light ones. Whatever the hub's palette becomes, the
cheap insurance is a checked list of foreground/background *pairs* rather than a list of
colours — the harness in §0 computes those ratios and can be pointed at any page.

Files touched by this audit: **none.** `globals.css`, `components/ui.tsx` and the screens
outside `connectors/` are shared or Front-end 1's; these are reports, not diffs.
