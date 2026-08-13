# NeurAI Platform — restructure brief (DRAFT, accumulating)

> **Status: DRAFT — user directive captured 2026-08-13; the user has said more
> additions and changes are coming. Nothing here is dispatched until
> milestone 3 closes ("first finish what we are doing, then go for this" —
> user). The steward folds this into ARCHITECTURE.md as numbered amendments
> (M18 revision + new decisions) when the user's full list is in and
> milestone 3 is shut.**

## The pivot, in one paragraph

The product becomes a **platform named NeurAI** whose first page is an
**AI-assistant hub**; **Echo** (calls → transcripts → summaries) becomes a
**software/app inside that platform** — selectable from the hub and the menu.
Selecting Echo docks the assistant to the side and opens Echo's work surface
in the middle. Platform-level surfaces (user management, profile, server
management, etc.) exist at the NeurAI level, not inside Echo.

## Design reference (user-provided image, LIX-style AI hub)

Anatomy of the reference, for the design system pass:

- **Dark-first canvas**: near-black rounded app frame on a deep teal-gradient
  backdrop; content floats in a large rounded rectangle.
- **Slim icon rail** on the side (RTL: right): small square icon buttons,
  active item highlighted (accent-blue tile); avatar at the bottom; settings
  and theme toggles low on the rail.
- **Centerpiece**: iridescent orb/mark centered above a two-line greeting —
  small muted "Hi, {name}" + large bold "How can I help today?" + one muted
  caption line.
- **Prompt box**: wide rounded dark input ("Ask me anything…"), with small
  pill buttons inside it (import file, tools), mic icon, accent send button.
  A slim "unlock more with Pro" ribbon sits on its top edge in the reference
  (monetization ribbon — whether NeurAI keeps it is an OPEN question).
- **App/action cards under the prompt box**: a row of small dark cards with
  icon + title + one-line description ("Surprise me!", "Create image",
  "Summarise"). In NeurAI these become **app launchers** — Echo is the first
  app card.

Persian-first constraints carry over unchanged: RTL mirror of the whole
anatomy, Vazirmatn, fa digits/Jalali per locale rules.

## Brand: the NeurAI logo (user-provided, 2026-08-13)

Three variants received (user to drop originals into `mvp/brand/` —
gitignore review at that point; marks are shippable, source files may not
be):

1. **App-icon tile**: the N monogram on a deep indigo field.
2. **Lockup**: monogram above a NEURAI wordmark in a rounded techno face.
3. **Mark only**: purple monogram on transparent/light.

Anatomy: a two-stroke **N monogram** — the left half-N in white, the
diagonal+right stroke in violet sweeping into an arrowhead, with the
counter reading as an upward arrow/play wedge. Brand palette — **MEASURED
(Front-end 2, lossless decode; supersedes the estimates that stood here)**:
**violet `#A274FF`**, **indigo `#130036`**, white. Measured constraints
that shape the derivation: the mark structurally REQUIRES a dark ground
(white half-letterform = 1.04:1 on light — ruled: the indigo tile is the
mark's ground everywhere; light-ground variant = commissioned asset only);
white on violet is 3.24 (fails AA) so **--on-accent is DARK** in this
system; the violet cannot be light-theme ink (3.24 on white — a derived
darker violet serves light ink). Violet-on-indigo = 5.99 natively: the
brand itself validates dark-first. **Ruled (steward, supersedes open
question 9): ONE accent family — violet; Echo is identified by its
soft-red MARK, never a second palette family** (concession path: a derived
violet tint if Echo reads weak). Echo-mark source correction: the Echo
Mobile launcher asset is a SELF-DECLARED PLACEHOLDER (teal dot-in-ring,
"Real brand asset is a Phase C item") — the record mark is drawn from the
user's description (filled circle in ring, soft red), with drift noted if
Echo Mobile ever gets a real mark. **Echo mark red RULED: `#FF6F59`** —
chosen by measurement, not taste: the obvious soft reds sit within ~35
perceptual distance of `--danger` (#FB7185), so Echo's launcher tile
would have read as an ERROR STATE; #FF6F59 is 77 away and 7.1:1 on the
hub canvas. Token system: computed palette + runnable verifier
(design-system/neurai-platform/verify-pairs.mjs, exits non-zero,
verified-red) — the design system's own rule-13 artifact.

**Design-system consequence, flagged for the milestone-4 pass:** the ruled
Echo system is NAVY (#0F172A, accent #0369A1) and its style profile's
avoid-list said "no AI purple". The NeurAI brand is **purple-on-indigo** —
a deliberate user branding decision that supersedes that avoid-note at the
PLATFORM level. To resolve at the design pass (open question 9): does the
whole shell re-derive around the purple brand, or does the NeurAI shell go
purple while Echo-the-app keeps its navy interior? The hub reference
image's teal backdrop is likely superseded by the logo's indigo.
`web/app/icon.svg` (currently a navy placeholder) gets replaced by the N
tile at milestone 4.

**Echo's app mark (user, 2026-08-13):** derived from the **Echo Mobile
(Android) logo — the record-button mark** — adjusted for the platform and
recolored **shallow (soft) red**. Source asset lives in the
Desktop\Neurai-Echo repo (the app icon); the platform variant gets drawn
at the milestone-4 design pass with the exact red sampled/decided then.
So the app-inside-platform identity model is: NeurAI = violet N, Echo =
soft-red record mark; both marks locale-invariant. (Whether Echo's
INTERIOR stays navy or re-derives is still open question 9 — the red is
the mark's color; no ruling yet on the app's surface palette.)

## The IA changes (user directive, verbatim intent)

1. **First page = the AI assistant** (the hub above): assistant centered,
   menu on the side, app cards (Echo, …) under the prompt box AND as menu
   entries.
2. **Selecting an app (Echo)**: the assistant moves to the side pane
   (existing dockable-assistant pattern), and the app's work surface opens
   in the middle — for Echo: **Record on top, Calls below, merged into one
   screen** (ضبط + تماس‌ها become one surface; record is the top section,
   the calls list below it).
3. **Skills and Connectors move INSIDE Management** — no longer top-level
   nav items.
4. **Platform-level surfaces** at the NeurAI level: **user management,
   profile, server management, and the rest** — "add the things regarding
   to them if we don't have them" (user). Inventory vs. today:
   - User management — EXISTS (admin members + pending queue) → moves to
     platform level.
   - Profile — EXISTS → platform level.
   - Server management — PARTIAL/NEW: proposed scope for the cloud product:
     model-provider status + API key health, storage usage, worker/queue
     health (pgmq depths, dead letters), org-level settings; the operator
     view of what NeurAI-on-prem would call the server. NEEDS user
     confirmation of scope.
   - (etc. — user signalled more; accumulate here.)
5. **Naming**: **NeurAI = the platform; Echo = an app inside it.** This
   revises M18 (which made Echo the product brand). Open naming questions
   below.
6. **Top bar** (user, 2026-08-13 second batch): carries the **en/fa
   language switcher**, **search** (REMOVED from the side menu — global
   search lives in the top bar), and the **profile avatar** (this
   overrides the reference image's avatar-at-rail-bottom placement).
7. **Bottom of the side menu**: **Settings**, **Help**, and a **GitHub
   repo** link.
8. **Settings IA** (user, 2026-08-13 third batch — structure adopted, NOT
   the reference's visual design). Sectioned settings surface:
   - **CONFIGURATION**: General · Security · SSO
   - **CONNECTIONS**: OAuth Apps
   - **COMPLIANCE**: Audit Logs · Audit Log Drains · Legal Documents

9. **User Management IA** (user, 2026-08-13 fourth batch — structure
   adopted, NOT the visual design). Anatomy: three **stat tiles** (total /
   active / inactive users, with trend deltas); **search** over members;
   **columns / filter / export** controls; **"Add user"** primary action;
   table with **multi-select checkboxes**, avatar + name + email,
   **inline role dropdown** per row, **date added**, **last active**
   (sortable), per-row delete + overflow menu.

   **ALL options adopted per user directive (2026-08-13): every element
   above ships in User Management** — stat tiles (counts from
   `app_user.status`), search, columns picker, filters, export, Add user,
   multi-select with bulk actions, inline role dropdown, date added,
   sortable last-active, per-row delete, overflow menu. Questions 13–15
   are therefore HOW rulings (what Add user / delete / the role list do
   underneath), not whether-to-include — the controls exist regardless;
   the semantics follow the answers.

   **Data-reality corrections (Backend 1's verified-against-the-schema
   pass, 2026-08-13 — two of the brief's claims were wrong):**
   - An earlier draft said `last_seen_at` "is on the wire" as if usable.
     It is declared, selected, served, tested — **and nothing in the repo
     has ever written it**; the sortable column would sort nulls forever.
     The inverse of stored-and-unqueried: *queried-and-never-stored* — it
     reached this brief as a fact because being on the wire is exactly
     what availability looks like from outside. Fix costed for m4 — with
     one CONSTRAINT that will be lost and re-derived wrongly if it lives
     only in a thread (Backend 2, relayed by Backend 1): **the worker
     must never write it.** Pipeline jobs run AS the call's owner (M3),
     and `identityForJob` calls the shared `resolveIdentity` — so the
     obvious implementation (stamp in the shared resolver) would mark a
     person "active" because a background job touched their recording at
     3am while they slept. "Last active" means A HUMAN DID SOMETHING: the
     stamp belongs only in the api's identity path, as a deliberate
     write, WITH a write-throttle decision (at most once per N minutes,
     or it is a row update per request). The shared resolver is the
     obvious place and the wrong one — that sentence is the point of
     this note. And the inversion, in Backend 2's words: stored-and-
     unqueried is invisible until someone looks; **queried-and-never-
     stored is worse than visible** — on the wire, in tests, in a
     planning document as an established capability, because being on
     the wire is exactly what availability looks like from outside.
   - **Stat-tile TREND deltas need history that does not exist**: counts
     are trivial, but "+3 active this month" needs to know WHEN status
     changed — `accepted_at` gives activations; nothing records
     deactivations. v1 choice: plain counts without deltas, or a
     status-history record (new schema). Deltas must not be faked.

   **Cheaper than it looks (same pass):** Audit Logs is near-free
   (`admin_action` + `proposal_decision` + `agent_run` are the trail's
   three halves, all readable under existing policies); server
   management's queue depths and dead-letter counts are already permitted
   reads (0017/0019 grants); provider/key health is served `api_key`
   metadata. Storage usage is the only genuinely new plumbing.

   **Method rule for the m4 amendment (adopted from the same review):
   every new surface's assumed data gets a "verified against the schema"
   pass before the amendment is cut** — an hour of checking that catches
   the believed-because-describable class (the Claude filter's shape:
   items 3 and 4 above both entered this brief as facts because they are
   visible from outside).

   Mapping against today (steward inventory, for the amendment):
   - *General* — exists in pieces (org name, defaults, language/theme).
   - *Security* — new surface; candidates: password change, sessions,
     the gateway keys summary.
   - *SSO* — was EXPLICITLY excluded from v1 by SPEC («not built: SSO»);
     its appearance here needs a scope decision → open question 11.
   - *OAuth Apps* — new; relationship to the gateway (API keys/webhooks)
     to define — likely the connectors/gateway surface re-homed under
     CONNECTIONS.
   - *Audit Logs* — buildable NOW from existing data (`human_action` +
     `agent_run` are the two halves of the audit trail; a read UI over
     them).
   - *Audit Log Drains* — new (outbound audit shipping — webhook-like,
     rides M17's dispatcher pattern when built).
   - *Legal Documents* — new static surface (terms/privacy).

## Open questions for the user (answer whenever — none block milestone 3)

1. **Branding surface**: does sign-in/branding say NeurAI (platform) with
   Echo appearing only as an app tile, or "Echo by NeurAI"? Affects M18
   revision, sign-in screen, repo/README naming.
2. **Server management scope**: is the proposed scope above (providers,
   keys, storage, queues, org settings) what you mean, or do you mean
   deployment/on-prem controls too?
3. **The "Pro" ribbon** in the reference: does NeurAI have a plan-upsell
   surface, or does M15 (one subscription, whole package) stand? M15 stands
   unless you say otherwise.
4. **Other apps**: is anything beyond Echo planned near-term (even as a
   "coming soon" card), so the hub reads as a platform rather than a
   one-app shell?
5. **Hub assistant scope**: the hub's assistant — same org-scoped assistant
   as today (answers over all reachable calls), or a broader
   general-purpose one when no app is selected?
6. **The GitHub link**: which repo does it point at — is Dr-Bagheri/MVP
   going public, a separate public repo/docs site, or is this an
   internal-build convenience to remove before sale? (A private-repo link
   404s for customers.)
7. **Help**: what does Help open in v1 — a docs page (needs writing), a
   contact-support mailto, or a placeholder? The suspended-state copy
   already points users at "پشتیبانی اکو", so Help is where that path
   should land.
8. **Settings vs Management vs Profile**: with Settings joining the menu
   bottom, confirm the split — proposal: Profile (avatar menu, top) =
   personal identity; Settings (menu bottom) = personal preferences
   (language default, theme, assistant model); Management = org/admin
   (members, skills, connectors, server management).
9. **Purple vs navy**: platform shell re-derives around the purple brand —
   but does Echo-the-app keep its navy interior as its own app identity,
   or does everything go purple?
10. ~~Persian brand typography~~ **ANSWERED (user, 2026-08-13): the logos
   stay the SAME in fa and en — no locale variants, for both NeurAI and
   Echo.** Latin marks serve both locales; UI text stays Vazirmatn.
11. **Settings depth per section**: which sections are REAL in the
   restructure vs present-as-placeholder? Audit Logs is buildable now
   from existing data; SSO and the compliance items were v1-excluded by
   SPEC — does their appearance in Settings revise that exclusion
   (build them), or do they render as "coming soon" entries so the IA
   is complete while the features arrive later?
12. **Where do the admin surfaces land in this Settings IA** — members
   list/pending queue, model allow-list, server management: under
   CONFIGURATION (e.g. General/Security), as their own section (e.g.
   ORGANIZATION), or does "Management" remain a separate destination
   from Settings? (Supersedes the older question 8 proposal.)
13. **ANSWERED (user, 2026-08-13): BOTH.** The invite flow AND direct
   admin creation ship. Consequence for the amendment: the acceptance
   gate's single-door property (db/D8) is formally revised — the direct-
   create path becomes a designed, numbered second door (admin vouching
   = acceptance built in), not an accident; invite gets its schema +
   email path costed. Original analysis kept below for the amendment:

   **"Add user" vs the single registration door.** M15/db-D8: the ONLY
   way an account is created is self-registration → pending → acceptance
   ("the acceptance gate must not have two doors" is load-bearing in the
   schema — register_account ALWAYS produces pending, and Backend 1
   deliberately declined an admin-side create for this reason). "Add
   user" is two different products wearing one label: (a) an INVITE —
   creates a pending row + an invitation artifact (new schema, and an
   email path the product doesn't have yet) — or (b)
   admin-creates-active-account, which revokes M15's guarantee outright.
   The UI is identical; the products are not. Recommendation: (a),
   decided as a rule before it is drawn as a button.
14. **ANSWERED (user, 2026-08-13): BOTH disable AND true delete — true
   delete behind a warning + explicit confirmation.** Consequence for
   the amendment: true deletion of a member must solve the append-only
   reference problem below (anonymize/tombstone the person while
   preserving audit lines; likely echo_purge involvement) — designed as
   a numbered decision, never improvised. Original analysis kept:

   **Per-row DELETE vs disable.** A member is referenced by
   agent_run.actor_id, proposal_decision.decided_by, summary.created_by
   and every audit line — all append-only by design — so deleting a
   person either breaks the audit trail or MEANS disable, which exists.
   Recommendation: v1 delete = disable (+ hide from default view); hard
   deletion joins the compliance seam. **And the label must say what it
   does** — "a control labelled delete that disables is the «کلید
   سازمان» problem in a verb."
15. **ANSWERED (user, 2026-08-13): THREE roles — admin, owner, member.**
   SPEC's "only these two roles" is revoked at the amendment. Steward's
   proposed owner semantics, to confirm or correct at amendment time:
   **owner = the org's root** — the founding admin becomes owner;
   owner manages admins (promote/demote/disable) and org-level
   irreversibles (org deletion, member true-delete, billing later);
   admins manage members as today; exactly one owner per org v1
   (transfer = explicit action). Schema: member_role enum gains 'owner';
   RLS/trigger updates (admin self-change guard generalizes: nobody
   changes their own role; only owner changes admins). All numbered at
   the amendment.

## User review round 1 (2026-08-13, on the live shell — DIRECTIVES)

1. **Finish all sections to the end** — every started surface completes;
   necessary missing parts added without re-asking.
2. **Username is a first-class field**: profiles gain a username; the
   members/users tables show it in its own proper column (not an
   under-name annotation).
3. **The fa↔en switch must be SOLID — everything renders in the active
   locale, including people's names**: profiles ask for an **English
   version of the name** (`display_name_en`); en locale renders the
   Latin name everywhere (fallback: fa display_name — honest, never
   auto-transliterated). Evidence: the hub greeted "Hi, سارا محمدی".
4. **Prompt input alignment follows locale** — RTL entry/caret in fa,
   LTR in en.
5. **Dropdown chevron spacing** — the select's arrow sits too close to
   its border edge; fix globally.
6. **Members table gains a "last action" column** — last_seen_at is now
   written (api identity path), render it honestly (null = unknown, not
   a dash pretending to be data).
7. **Every sub-page gets a back affordance.**

## User review round 2 (2026-08-13, Settings sidebar screenshot — DIRECTIVE)

Section group headers (پیکربندی / اتصال‌ها / انطباق و سوابق) must not
read as menu items — currently the sidebar looks like one flat menu:
1. **Spacing**: a clear gap between a group title and its items (and
   above the next group) so the grouping is visible at a glance.
2. **Color**: group titles a step lighter or darker than items,
   theme-dependent (whichever recedes on that theme), so they read as
   LABELS, not destinations.
3. **Applies to ALL grouped menus**, not just Settings — one
   design-system pattern, adopted everywhere a menu has group headers.
   Scope [steward-confirmed on FE1's flag]: MENU group labels only —
   content section headings (e.g., Summary/Transcript over call
   detail cards) are structure and must NOT recede; forcing the
   pattern there would invert its purpose.
4. **Management adopts the Settings LAYOUT** (same review pass, same
   screenshot as the example): a sidebar beside — each section an
   option in the menu — with the page content coming in the middle.
   One two-pane shell pattern shared by Settings and Management, so
   the platform's two admin surfaces read as siblings.
5. **Breadcrumb trail on top [REVISES round-1 item 7]** (2026-08-13,
   Supabase org/project/branch bar as the example): the top bar shows
   the path "like folders" as pages go deeper — every ancestor
   clickable, so the trail IS the back navigation. This is the chosen
   FORM of round 1's "back option for all sub-pages" (one mechanism,
   not a breadcrumb plus per-page back buttons); user flagged the back
   option still isn't visible on deep pages — twice asked, so this
   LEADS the layout batch. Deepest crumb = current page title,
   non-clickable; direction follows locale.
6. **Avatar/profile menu — required set** (2026-08-13, Supabase-menu
   screenshot as the example; "not all of it… these are the options
   we definitely need"): (a) identity header — name + email; (b)
   Account; (c) Theme; (d) Time and calendar (timezone + Jalali/
   Gregorian preference); (e) Sign out. The example's other entries
   are NOT required — the five are the floor, extras only if they
   earn their place. Any control that also lives in Settings shares
   ONE state (the "one control, two homes, never two states" rule).
   Calendar preference interacts with the locale-solid dates rule:
   default "Auto (follows language)" preserves ruled behavior; an
   explicit choice overrides.

## Sequencing (locked by the user's own instruction)

1. **Milestone 3 closes first** (write-tools live loop, dispatcher + purge,
   approval card, responsive/dark audit).
2. The user sends the rest of their additions; steward folds everything into
   ARCHITECTURE.md as numbered amendments (M18 [REVISED], M22+…) with a
   design-system re-run for the dark AI-hub language.
3. Restructure dispatches as **milestone 4** across the sessions.

## Impact notes (steward, for the eventual amendment — not dispatched)

- **web/**: new hub route as home; nav restructure (icon rail); Echo becomes
  a route-group whose shell docks the assistant; record+calls merged screen;
  skills/connectors under management; platform-level settings surfaces.
  The just-landed navy design system gets a dark-first re-derivation for the
  hub (the reference is dark-canvas; current system is light-first with a
  ruled dark mode — the RULED OVERRIDES block gets revisited deliberately,
  not silently).
- **core/**: little structural change — the assistant, skills, admin, models
  surfaces all exist; server-management adds read endpoints (queue depths,
  provider status, storage usage) and possibly org-settings CRUD. Apps are
  a UI concept in v1 (no schema change needed for "Echo as an app").
- **db/**: likely nothing for the hub itself; server-management reads may
  want a health view; org settings may want columns. Decide at amendment
  time.
- **M18 naming**: "Echo" remains the conversation-intelligence app name;
  "NeurAI" becomes the platform brand. The Android app naming convention
  (Echo Mobile) is unaffected. The neurai-mvp (on-prem predecessor) name
  collision is noted — the platform brand deliberately reuses the NeurAI
  name per the user.
