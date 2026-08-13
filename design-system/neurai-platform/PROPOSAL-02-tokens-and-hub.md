# NeurAI — proposal 02: the dark-first token set, and the hub screen

**From:** Front-end 2 · **To:** steward, for verdict · **Date:** 2026-08-13
**Covers:** deliverable (b) the dark-first token derivation · (c) the hub screen
**Depends on:** proposal 01, accepted — one violet accent family, Echo identified by its mark

---

## ⚠ RULED OVERRIDES — these beat the generator

`ui-ux-pro-max` was re-run for this pass (dark AI hub, variance 3 / motion 3 / density 8).
Three of its recommendations are overruled, for the same reasons the Echo system overruled
them, plus one new:

| generated | **ruled — use this** | why |
|---|---|---|
| Pattern "AI Personalization Landing" (dynamic hero, testimonials, smart CTA) | **App-shell hub** | It described a marketing landing page. Every NeurAI screen is behind auth — the same mismatch as Echo's "Enterprise Gateway" |
| Style "Exaggerated Minimalism" — `clamp(3rem, 10vw, 12rem)` headings | **Dashboard density**, one deliberate exception for the hub centrepiece | An authenticated working tool. The hub greeting is the *only* place oversized type is right |
| Inter / Inter | **Vazirmatn, both locales** | Persian-first, ruled, non-negotiable. Carried forward unchanged from the Echo system |
| Palette `#4338CA` / `#7C3AED` on `#0F172A` — "night indigo + dream violet on dark" | **the measured brand**: violet `#A274FF` on indigo `#130036` | Direction is right, values are generic. The brand asset is the authority |

**Kept from the generator:** its avoid-list ("light mode + poor data viz" — read as *dark is
primary*, which matches the pivot), the subtle-motion tier (150–300ms), and the pre-delivery
checklist. **Carried forward from the Echo system:** Vazirmatn both locales, dashboard
density, the no-emoji-as-icons rule, and the full avoid-list **minus its "no AI purple"
line**, which the user's own brand overrides.

---

## 1. Deliverable (b) — the token set

Dark is primary and light is derived **from** it, inverting the current Echo system. Every
pair below is asserted by `design-system/neurai-platform/verify-pairs.mjs`:

```bash
node design-system/neurai-platform/verify-pairs.mjs
```

It exits non-zero on any failure. **Its first run failed five pairs** — including the dark
accent chip at **4.48 against a 4.5 bar**, which is the same near-miss (4.42) that shipped in
the Echo system and survived a whole design pass. That is the argument for the file existing
rather than a table in a document nobody re-runs.

### 1.1 Dark — primary

| token | value | notes |
|---|---|---|
| `--bg` | `#130036` | **the brand indigo IS the ground**, measured from the asset |
| `--surface` | `#1C0A45` | cards, the prompt box |
| `--surface-2` | `#271258` | inset rows, table stripes |
| `--border` | `#3A2270` | hairline, decorative (1.39 — see §1.3) |
| `--border-strong` | `#7A5EB8` | control edges — **3.70**, clears the 3:1 bar |
| `--fg` | `#F2ECFF` | 16.85 on bg. Violet-tinted white, not neutral — a cold white reads dirty next to the violet |
| `--fg-muted` | `#B6A6D6` | 8.71 on bg |
| `--accent` | `#A274FF` | brand violet. **5.99** as text on bg |
| `--on-accent` | `#130036` | **DARK on violet.** White is 3.24 and fails — see §1.2 |
| `--accent-soft` | computed `#2C175B` | 12% accent over surface; accent on it = **4.69** |
| `--success` / `--warning` / `--danger` / `--info` | `#4ADE80` / `#FBBF24` / `#FB7185` / `#7DD3FC` | 10.22 / 10.67 / 6.62 / 10.69 on surface |

### 1.2 Light — derived

| token | value | notes |
|---|---|---|
| `--bg` | `#FAF8FF` | violet-tinted white, so light is visibly the same family |
| `--surface` | `#FFFFFF` | |
| `--surface-2` | `#F1ECFB` | |
| `--border` / `--border-strong` | `#E2D9F5` / `#8E7BB8` | strong = **3.70** |
| `--fg` / `--fg-muted` | `#160A2E` / `#5B4B7A` | 18.80 / 7.69 on surface |
| `--accent` | `#6D3BF5` | **a DERIVED ink, not the brand violet.** `#A274FF` is 3.24 on white |
| `--on-accent` | `#FFFFFF` | 5.84 on the light accent fill |
| `--accent-soft` | computed `#EDE7FE` | accent on it = 4.86 |
| status | `#166534` / `#92400E` / `#BE123C` / `#075985` | all ≥ 6.29 on surface |

**The role flip, stated once so nobody re-derives it wrongly:** `--accent` is not one colour
with two shades. In dark it is a *bright surface* that dark text sits on; in light it is a
*dark ink* that white sits on. `--on-accent` therefore flips from near-black to white. This
is exactly the failure that shipped twice in the Echo system — the auth mark inherited `--fg`
and collided in both themes because `--fg` and `--accent` moved together.

### 1.3 Two structural changes to the token model

1. **`--border` splits into `--border` and `--border-strong`.** Echo shipped one border token
   at **1.28:1** doing two jobs. A hairline card edge is decorative and WCAG asks nothing of
   it; the edge of an *input* is a control boundary and owes 3:1. One value cannot be both
   subtle enough to not draw the eye and strong enough to delimit a control.
2. **`--accent-soft` is computed, not hand-picked** — a 12% tint of `--accent` over
   `--surface`. Hand-picking it is what produced Echo's 4.42 chip, and a computed tint keeps
   the pair honest when the accent moves.

### 1.4 Echo's app mark — `#FF6F59`

Soft coral-red, per the user's directive. Two numbers behind the choice:
- **7.1:1** on the hub canvas — a mark should be legible, not merely visible.
- **77 perceptual distance from `--danger` (`#FB7185`).** This is the constraint that picked
  it: the obvious soft reds sit within ~35 of the danger token, so Echo's launcher tile would
  have read as an error state. Anything under ~60 collides.

Drawn from the user's description — filled circle inside a ring, the record-button form —
**not** derived from the Android asset, which is a self-declared placeholder (proposal 01
§1). Recorded risk: nothing keeps the two in sync if Echo Mobile later gets a real mark.

---

## 2. Deliverable (c) — the hub screen

### 2.1 The mark needs no tile here — and that is not luck

The steward ruled the monogram always sits on its indigo tile, because its white
half-letterform is 1.04:1 on light. **On the hub, `--bg` IS `#130036` — the tile colour.** So
the transparent PNG drops straight onto the canvas: white strokes at 19.43, violet at 5.99.
The tile rule binds on light surfaces and inside light-theme chrome; the dark hub satisfies
it by construction. Worth writing down so nobody "fixes" the missing tile later.

### 2.2 Anatomy, RTL (fa is primary — mirror for `en`)

```
┌──────────────────────────────────────────────────────────────┬────┐
│  [avatar]              [⌕ search]           [fa|en]          │ ▣  │ ← top bar
│                                                              │ ▢  │
│                          ◆  (N monogram)                     │ ▢  │ ← icon rail
│                                                              │    │   (right in RTL)
│                        سلام، سارا                            │    │
│              امروز چه کمکی از من برمی‌آید؟                    │    │
│         هرچه بپرسید در محدودهٔ دسترسی خودتان می‌ماند           │    │
│                                                              │    │
│   ┌────────────────────────────────────────────────────┐    │    │
│   │  بپرسید یا دستور بدهید…                    [🎤] [▶] │    │    │ ← prompt box
│   │  [＋ افزودن فایل]  [ابزارها]                        │    │    │
│   └────────────────────────────────────────────────────┘    │ ── │
│                                                              │ ⚙  │ ← settings
│   ┌──────────────┐  ┌──────────────┐                        │ ？ │   help
│   │ ● اکو        │  │              │                        │ ⌥  │   github
│   │ تماس‌ها،     │  │  (grid holds │                        │    │
│   │ رونوشت‌ها…   │  │   more apps) │                        │    │
│   └──────────────┘  └──────────────┘                        │    │
└──────────────────────────────────────────────────────────────┴────┘
```

**Decisions, each with its reason:**

- **The mark replaces the reference's iridescent orb.** The reference had no brand; we do.
  Inventing an orb would put a second identity on the first screen, competing with the mark
  users see in the rail, the tab icon and sign-in. The mark can carry a subtle idle motion
  (a slow violet glow, 3–4s, under the subtle-motion tier) to do the orb's *job* — signalling
  a live assistant — without a second identity.
- **Greeting is two lines, exactly as the reference.** Small muted «سلام، {name}», large bold
  «امروز چه کمکی از من برمی‌آید؟». This is the one place oversized type is ruled in.
- **A third, muted caption line carries the scope promise** — «هرچه بپرسید در محدودهٔ دسترسی
  خودتان می‌ماند». The reference's caption is filler; ours does work. The single most
  important thing a first-time user needs to know about an org-wide assistant is that it
  cannot see past their own permissions, and the hub is where that belongs.
- **The prompt box is a control**, so it takes `--border-strong`, and its send button is an
  `--accent` fill with a `--on-accent` (near-black) glyph — the §1.2 flip, applied at the most
  looked-at control on the page.
- **App cards are a responsive grid holding 1..n**, showing Echo alone today. Open question 4
  (other apps) is unanswered, so I have **not** invented "coming soon" tiles — a fabricated
  roadmap on the first screen is a claim we would have to keep. The grid accommodates more
  without redesign.
- **No "Pro" ribbon.** M15 (one subscription, whole package) stands unless the user says
  otherwise; a monetisation ribbon over a product with no upsell would be decoration
  imitating a business model.

### 2.3 Mobile (375) — per proposal 01

Rail becomes the four-item bottom bar. The hub's centrepiece stacks: mark, greeting (type
steps down), prompt box full-width, app cards single-column. **The assistant is the page
here** — no pane, no sheet, nothing to dismiss, per the accepted invariant: *the app must be
reachable on load, at every width, without dismissing anything.*

---

## 2.4 The rendered mock — `hub-mock.html`

Open `design-system/neurai-platform/hub-mock.html`. Four panels: **dark/فارسی/1280** (the
primary), **light/فارسی/1280**, **dark/English/1280**, **dark/فارسی/375**. It uses the real
brand PNG, real Vazirmatn, and **imports its tokens from `verify-pairs.mjs`** so the mock
cannot drift from the palette that was actually asserted.

Measured on the render, not on the token table:

| | |
|---|---|
| rail side | RTL → **right**, LTR → **left**, mobile → no rail, bottom bar present |
| `.ask` / `.scope` / card text, dark | 16.85 / 8.71 / 15.46 / 7.99 |
| `.ask` / `.scope` / card text, light | 17.85 / 7.30 / 7.69 |
| **send button** | dark **5.99** (near-black glyph on violet) · light **5.84** (white glyph on the ink) |
| **active rail tile** | **5.99** — the most-looked-at element on the page |
| mobile hit areas | avatar/search/mic/send/pills — visual 31–38px, **hit box a true 44** (hits at 18px from centre, misses at 30) |
| horizontal overflow at 375 | 0 |

**One correction the render made to me.** §2.2 claimed the rail sits at the inline-end so
RTL puts it right "with no logic". Wrong: in RTL the inline-*end* is the LEFT edge. The first
build rendered the rail on the wrong side in *both* locales — right idea, inverted
implementation. The rail belongs at inline-**start**. The claim in the proposal read as
correct and the CSS did the opposite, which is the same lesson as §6 of the Echo audit:
**verify the rendered artifact, not the source that should have produced it.** I would not
have caught it by re-reading the CSS, because the CSS matched the sentence I had written.

## 3. What I need

1. **Verdict on the token set** — particularly `--border-strong` as a new token in the model,
   since it changes every component that draws an edge.
2. **Verdict on `#FF6F59`** for Echo, or a different red if the user has one in mind; the
   danger-collision constraint holds for any candidate.
3. **Verdict on the hub anatomy**, especially the mark-instead-of-orb call and the scope
   promise as the caption line.
4. Confirmation that **no invented app tiles** is the right read of open question 4.

On approval I can produce a rendered mock of the hub in both themes and both locales for the
user's design review, which is the artefact worth putting in front of them rather than this.
