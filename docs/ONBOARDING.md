# The first-time experience — the gate, the flow, the first-run door

**BUILT 2026-09-15 (M54).** Companion to `docs/B2C-STRUCTURE.md`. The shape
follows the reference the user pointed at (Wispr Flow's web onboarding —
"the login page and how it connects step by step … same way, on the web");
every question is the platform's own.

## 1. The gate — `/sign-in` (and `/sign-up` redirects here)

One email field. **Continue** sends a mail with a one-click LINK and a
six-digit CODE; the same screen accepts either. A password is one link away
for whoever has one. Signing up and signing in are the same act — GoTrue
creates the identity when the address is new, and the product registers the
person on their first successful verify (into a workspace of their own,
db/0223).

| state | what is on screen | request |
|---|---|---|
| email | the address, «Continue» | `POST /api/auth/otp` → GoTrue `/otp` (`create_user`) |
| code | «check your email», the six-digit box, «send again» (60 s), «use a different email», «sign in with a password» | `POST /api/auth/otp/verify` → GoTrue `/verify` `{type:"email"}` → session cookie |
| the link | `/api/auth/confirm?token_hash=…&type=magiclink` → session cookie → `/sign-in?confirmed=1` → route by identity | server-side exchange (M1) |
| password | the previous gate, whole | unchanged |

After a session exists, `identityState()` decides the landing exactly as
before, plus one line: a member whose `onboarding_completed_at` is `null` goes
to `/onboarding`; a member with a stamp goes home; a deployment that serves no
stamp at all goes home (an ABSENT field is not an unfinished flow).

## 2. The flow — `/onboarding`

Outside the shell, with its own five-stage rail. Eleven steps; every answer
is PATCHed the moment it is given (`PATCH /api/me/onboarding` → core
`/v1/me/onboarding`, which MERGES into `app_user.onboarding`), the step is
saved with each Continue so a reload resumes, and the stamp lands once — on
«start working» or on «later» (every screen has «later»; a flow with no exit
is a wall).

| stage | step | what is asked / tested | answer key |
|---|---|---|---|
| Sign up | welcome | «Welcome, {name}!» — where did you hear about us | `source` |
| | goals | how can NeurAI help you — meetings / assistant / tasks / team room | `goals[]` |
| | work | what do you do — and a level | `work`, `level` |
| | places | where your work happens — meetings, email, chat, docs, notes, code, calendar | `places[]` |
| Permissions | data | you control your data — «recognise my voice» (a voiceprint later) or «no voice signature» | `voiceprint` |
| | mic | test your microphone — twelve bars off the real meter, change device | `micOk`, `micDevice` |
| Set up | languages | the languages you speak (the UI language pre-chosen) | `languages[]` |
| | hotkey | test the keyboard shortcut — choose a key, hold it, it turns green (the product's real push-to-talk binding) | `hotkey` |
| Learn | dictate | use NeurAI to send a message — a mock team room, hold the key and speak (the composer's real dictation) | `dictated` |
| | faster | «Nice job! speaking can be N× faster» — 40 vs 150 words/min, the dark reveal | — |
| Personalize | savings | «with NeurAI you could save N hours a week» — a slider of typing hours a day, labelled as an estimate | `typingHoursPerDay` |

Nothing in the flow writes into the workspace it is introducing (no test
recording, no model call) — the 2026-09-06 lesson. The product's own controls
are taught by the door below, on the real screens.

## 3. The first-run door — Home, once

«How would you like to use NeurAI first?» — five choices, a preview, «try it
now» / «later». «Try it now» starts a LESSON: the existing tour mechanism
(`lib/tour.ts`) dims the screen and rings the real control:

| choice | goes to | rings |
|---|---|---|
| record a meeting | `/meetings` | `data-tour="meetings-new"` |
| ask the assistant | `/` | `data-tour="home-composer"` |
| plan your tasks | `/tasks` | `data-tour="board-add"` |
| invite your team | `/management/invitations` | `data-tour="invite-people"` |
| connect Gmail & Calendar | `/integrations` | `data-tour="integrations-shelf"` |

The choice is recorded (`firstRunSeen`, `firstRunChoice`); the door never
opens twice.

**Videos.** The reference plays a screen recording per choice. The slot is
`ONBOARDING_VIDEOS` in `web/src/components/onboarding/lessons.ts` — every
entry is `null` today and the door draws the lesson's illustration with «a
short video is coming». Record five 30–60 s screencasts of the real product,
put them under `web/public/onboarding/`, and set the URLs; the test asserts a
`<video>` renders only when a URL is present.

## 4. Where things live

```
web/src/app/[locale]/(auth)/sign-in/page.tsx   the gate (email → code → password)
web/src/app/api/auth/otp/route.ts               send me a code
web/src/app/api/auth/otp/verify/route.ts        the code → a session
web/src/app/api/auth/confirm/route.ts           the link (type=magiclink joined signup/email)
web/src/app/[locale]/onboarding/page.tsx        the flow's route (outside the shell)
web/src/components/onboarding/                  steps.ts (the shape) · Onboarding.tsx (the controller)
                                                 OnboardingFrame.tsx (rail + layouts) · QuestionScreens.tsx
                                                 SetupScreens.tsx · bits.tsx · Illustrations.tsx
                                                 FirstRunDoor.tsx · lessons.ts
web/src/app/api/me/onboarding/route.ts          the save
core: PATCH /v1/me/onboarding, members.updateOnboarding, /v1/me (+ onboarding, onboarding_completed_at, org_kind)
db/0223                                          the columns, the founding branch, the trigger
```

## 5. Operator step — the Supabase email template (REQUIRED)

Supabase → Authentication → Email Templates → **Magic Link**. Subject
«ورود به نورای / Sign in to NeurAI». Body:

```html
<h2>ورود به نورای</h2>
<p>برای ورود روی این پیوند بزنید:</p>
<p><a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">ورود به نورای</a></p>
<p>یا این کد را در صفحهٔ ورود بنویسید:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
<p>این کد و پیوند تا یک ساعت معتبرند. اگر شما درخواست نداده‌اید، این نامه را نادیده بگیرید.</p>
<hr>
<p>Sign in with one click: <a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in to NeurAI</a></p>
<p>Or type this code on the sign-in page: <b>{{ .Token }}</b></p>
```

Why it is required and not optional: the default template links through
GoTrue's own `/verify`, which lands the browser at the site root with the
session in the URL **fragment** — the arrangement M1 forbids (the browser
never holds a token). The app refuses to read it and sends the person to
type the code instead (`?confirmed=fragment`) — but the default template
carries no `{{ .Token }}` either, so until the template is changed the gate is
correct in code and unreachable in configuration, exactly the confirm/recovery
situation of 2026-08-15. **Site URL** must be `https://app.neurai.pt` (it is).

Also worth checking while there: **Rate Limits → "Rate limit for sending
emails"** (raise from the default before announcing), and that **custom SMTP**
is on (Resend, since 2026-08-15 — the built-in sender allows ~3 mails an hour).

## 6. What is proven, and what only a person can prove

- Tests: the gate (three screens, routing by the server's answer), the two
  routes (what GoTrue is asked, what the browser is told), the flow (every
  answer leaves the browser, resume, the stamp once, «later»), the door (the
  real lesson, the video slot's two states), the shell's redirect with its
  control, the migration's matrix (db/test/127), core's merge statement.
- **Not provable from this side:** a real email arriving and being clicked —
  it needs the template above and a mailbox. The first real sign-up through
  the gate is the acceptance run; record it in CLAUDE.md when it happens.
