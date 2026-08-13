# NeurAI — proposal 01: mobile shell, and the purple-vs-navy ruling

**From:** Front-end 2 · **To:** steward, for verdict · **Date:** 2026-08-13
**Covers:** deliverable (a) the held mobile-nav proposal · (d) purple-vs-navy recommendation
**Status:** PROPOSAL. Nothing is built until the verdict.

Deliverables (b) the dark-first token derivation and (c) the hub screen follow; §1 below is
their evidence base and is already measured, so both are unblocked by this verdict.

---

## 1. The brand, measured — three corrections to the brief

The brief's palette was flagged in it as visual estimates. I sampled the delivered assets
instead: the PNG losslessly (own decoder — zlib inflate + PNG unfiltering), the two JPEGs by
canvas pixel read. **All three corrections matter to the derivation.**

| | brief's estimate | **measured** | note |
|---|---|---|---|
| violet | `#8B6CF0` | **`#A274FF`** | from the *lossless* PNG; the JPEGs average `#A374FF`, which is compression noise. Real violet is markedly lighter and more saturated than the estimate |
| indigo ground | `#1A0B33` | **`#130036`** | bluer and darker; measured over a 92%-of-frame flat field in both JPEGs, so it is reliable despite the lossy source |
| white | white | `#FFFFFF` | confirmed |

**Correction 1 — `neurai-icon.png` has no indigo in it at all.** It is 74.5% *transparent*,
carrying exactly two colours: the violet and white. The brief described it as "the N monogram
on a deep indigo field"; that is the tile JPEG. The two JPEG filenames were also swapped
relative to their contents.

> **RESOLVED** (steward, same day): the two JPEGs are renamed to match their contents and
> `brand/README.md` now carries the measured palette as the record. Current state —
> `neurai-icon.png` = transparent monogram · `neurai-mark.jpg` = monogram on the indigo tile ·
> `neurai-lockup.jpg` = monogram + NEURAI wordmark on the tile. Kept here because the
> measurements below were taken against the pre-rename files.

**Correction 2 — the mark structurally requires a dark ground.** The N is built from a violet
diagonal-and-right-stroke *plus a white left stem and inner diagonal*. The white strokes are
not decoration; they are half the letterform. On a light surface, white-on-`#F8FAFC` is
**1.04:1** — they vanish, and the remaining violet reads as a slash, not an N.

> **Consequence, and it needs a ruling:** the transparent PNG cannot be dropped onto a light
> surface. Wherever the mark appears in a light context it must sit on its own indigo tile
> (the app-icon treatment), or a light-ground variant must be drawn. This is a brand-asset
> gap, not a CSS problem — I can specify it but not invent it.

**Correction 3 — Echo's mark has no source asset.** The brief says Echo's platform mark is
"derived from the Echo Mobile (Android) logo — the record-button mark". The actual asset at
`Neurai-Echo/app/app/src/main/res/drawable/ic_launcher_foreground.xml` is a **teal
`#2DE0C8` dot-in-ring**, and its own first line reads:

```xml
<!-- Placeholder mark: a neon echo dot. Real brand asset is a Phase C item. -->
```

It is self-declared provisional, and it is not red. This is the same shape as the
`last_seen_at` finding in the brief: **an asset that is present, referenced, and looks
authoritative from outside is not thereby a source of truth.** Deriving from it would
propagate a placeholder into the platform brand.

The user's *description* is executable regardless — a filled circle inside a ring is exactly
a record button, which is what that placeholder happens to draw, so the intended shape is
unambiguous. I propose treating the directive as **"draw a record mark in soft red"** rather
than **"derive from the Echo Mobile asset"**, and flagging that if Echo Mobile ever gets its
real brand mark, nothing will automatically keep the two in sync.

### 1.1 The pairs, computed

| pair | ratio | verdict |
|---|---|---|
| violet `#A274FF` on indigo `#130036` | **5.99** | AA — *the brand's own pair works, natively, in dark* |
| white on indigo `#130036` | 19.43 | AAA |
| **white on violet** | **3.24** | **FAILS AA for normal text** |
| indigo `#130036` on violet | 5.99 | AA |
| near-black `#0B0118` on violet | 6.28 | AA |
| **violet as text on white** | **3.24** | **FAILS** |
| violet as text on `#F8FAFC` | 3.10 | FAILS |

Two findings that shape the whole derivation, and both are the §2 pair-failure pattern from
the Echo audit arriving again in the new brand — which is the argument for carrying that
checklist forward rather than re-learning it:

1. **`--on-accent` must be DARK on this brand.** White on violet is 3.24. Every violet-filled
   surface — the active icon-rail tile, the send button, primary CTAs — needs a near-black
   foreground, not white. This is the most-looked-at element on the new first page, and it is
   the exact pairing that failed twice in the Echo system.
2. **The brand violet cannot be light-theme body/accent text.** At 3.24 on white it is a
   *surface and mark* colour, not an ink. A light theme needs a derived darker violet —
   `#6D3BF5` gives 5.84, `#5B21B6` gives 8.98. The brand violet stays for marks and fills.

For comparison, Echo's navy accent `#0369A1` is 5.93 on white and its dark theme uses a
*different* token (`#38BDF8`, 9.42 on near-black). **The two systems have opposite native
modes**: NeurAI's brand is born dark, Echo's palette was born light. That fact decides §3.

---

## 2. Deliverable (a) — the mobile shell

### 2.1 The invariant this proposal exists to protect

The audit's blocker was the assistant covering the app: an opaque full-viewport pane, open by
default, leaving every screen unreachable while every layout metric improved. The rule that
falls out is the one constraint I would ask to be ruled *before* the pattern:

> **The app must be reachable on load, at every width, without dismissing anything.**

Any assistant pattern that opens over content by default violates it, however good it looks.

### 2.2 Proposal: bottom bar under `md`, icon rail from `md` up

The rail is the desktop nav. Below `md` it becomes a **bottom bar of four items**:

```
        ┌─────────────────────────────────────────┐
        │  [hub]    [Echo]   [Management]  [More] │   ← 56px + safe-area inset
        └─────────────────────────────────────────┘
```

- **Four, not five** — Hub · Echo · Management · More. Under the ≤5 ceiling with a slot spare
  for the second app, which is the growth the platform framing implies. Apps beyond the
  second go behind an Apps entry rather than stretching the bar.
- **More** opens a sheet carrying the rail's bottom group — Settings, Help, GitHub — plus any
  overflow apps. These are low-frequency destinations and do not deserve permanent slots.
- **RTL is free.** A horizontal bar's item order follows `dir` with no mirroring logic, which
  is a real argument over a drawer: a drawer must choose a side and mirror it, and the
  current pane's side handling is exactly where the shell has already gone wrong once. Icons
  must be non-directional (no arrows/chevrons in the bar).
- **Touch**: bar height 56px, each target ≥44×44 with the ruled `.tap` mechanism, plus
  `env(safe-area-inset-bottom)` so the iOS home indicator does not eat the row.

### 2.3 The assistant on mobile — a sheet, never a default-open layer

The assistant has two lives, and conflating them is what produced the blocker:

**On the Hub, the assistant IS the page.** No pane, no overlay, nothing to dismiss — the
greeting, prompt box and app cards are the screen. This is the case the current code gets
wrong by rendering a pane over a hub that is itself the assistant.

**Inside an app, the assistant is a bottom sheet** with these mechanics:
- invoked by a persistent compact pill sitting above the bottom bar ("از دستیار بپرسید…"),
  which is an affordance, not a layer — it occupies ~40px and never covers content;
- opens to ~85vh over a scrim, closes on backdrop tap, on Esc, and on a drag-down;
- focus-trapped while open, focus restored on close;
- **never open on load** — no exception, no "remember last state".

Desktop keeps the docked column exactly as it is today; it works and the audit found nothing
against it at ≥`md`.

### 2.4 Top bar at 375

Three controls plus a title do not fit 375px. Proposal:
- **search** collapses to an icon that expands to a full-width field on tap;
- **avatar** stays;
- **language switcher moves into the avatar menu** — it is a set-once-a-year control and does
  not earn permanent space at mobile. It stays visible in the top bar from `md` up.

### 2.5 What this proposal deliberately does not decide

Sheet vs full-screen for the assistant *inside an app* at tablet widths; whether Management is
a bottom-bar peer or belongs behind More once a second app exists. Both are cheap to change
after the hub exists and expensive to guess now.

---

## 3. Deliverable (d) — purple vs navy: **one accent family, violet**

**Recommendation: the platform and Echo share a single violet accent family. Echo is
identified by its mark and its content, not by a second palette.**

### Why

1. **Two accent families doubles the pair matrix in exactly the place this codebase keeps
   getting hurt.** Every accent needs a checked `--on-accent`, focus-ring, soft-fill and
   hover pair, per theme. The Echo audit found four pair failures in *one* family; two
   families is not twice the tokens, it is twice the surface for the same class of bug. §1.1
   already shows this brand has its own `--on-accent` trap waiting.
2. **The two palettes have opposite native modes.** NeurAI's violet is born dark (5.99 on its
   own indigo, fails on white). Echo's navy accent is born light (5.93 on white, needs a
   different token in dark). Keeping navy inside a dark-first shell means maintaining a
   light-first palette in a dark-first world — inheriting both systems' weak halves.
3. **App identity in a platform comes from the mark, not from re-themed chrome.** No desktop
   OS lets an app recolour the shell. Echo's soft-red record mark does the identifying work at
   the launcher, the app card, the rail tile and the app header — which is where a user
   actually asks "which app am I in".
4. **It is the cheaper thing to reverse.** Shipping one family and later giving Echo a tint is
   additive. Shipping two and merging them is a re-derivation of every screen.

### The concession, so this is not a one-way door

If Echo's identity reads as too weak once the hub exists, give Echo a **derived** app tint —
a single hue-shifted token *within* the violet family for its app header and active states —
rather than reinstating navy as a second family. That keeps one `--on-accent`, one focus
ring, one pair checklist.

### What this means for the ruled Echo system

`design-system/echo-platform/MASTER.md`'s RULED OVERRIDES block was a *light-first navy*
verdict. Under this recommendation it is superseded at the platform level rather than
silently abandoned — and its two survivors carry forward explicitly: **Vazirmatn for both
locales** (unchanged, non-negotiable) and **dashboard density** (unchanged). The avoid-list
loses only its "no AI purple" line, which the user's own brand overrides.

---

## 4. What I need to proceed

1. **Verdict on §3** (one family vs two) — it gates the entire token derivation, deliverable (b).
2. **Ruling on §1's mark-on-light gap** — indigo tile everywhere, or commission a light variant.
3. **Acceptance of §1's Echo-mark finding** — draw a record mark in soft red per the user's
   description, rather than deriving from a self-declared placeholder.
4. Verdict on §2's shell, or the parts of it you want changed.

Once §3 is ruled I can produce (b) the full dark-first token set — with the §1.1 pairs as the
checklist and both themes derived dark-first — and (c) the hub screen against it.
