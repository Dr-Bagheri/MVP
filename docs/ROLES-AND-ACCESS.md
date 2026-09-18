# Who can do what — the role report

*Written 2026-09-18 for the directive "check all roles restrictions and give
me a full report of it, and check if all that we agreed on before were
applied".*

Every fact in this document was read from the production database by
`db/scripts/probe-roles.mjs`, which writes nothing and can be re-run at any
time. That matters more than it sounds: a report assembled from memory is
testimony, and this repo has been wrong twice about what it believed a wall
did. Where something is a JUDGEMENT rather than a reading it says so.

---

## 1. There are four walls, not one

A person's role is the fourth and weakest of them. In order, from the outside
in:

| # | Wall | What it refuses | Where it lives |
|---|---|---|---|
| 1 | **The database role** | `echo_app` and `echo_agent` cannot bypass RLS, and neither is a superuser | Postgres roles |
| 2 | **Row-level security** | which ROWS the caller can see at all | one policy per table, FORCED |
| 3 | **The grant** | which VERBS the role holds — e.g. the agent holds no `DELETE` anywhere | `grant` statements |
| 4 | **The product role** | member / admin / owner, inside the policies | `echo.member_role` |

Read from production today: **no application role bypasses RLS**, and **every
`echo` table has RLS enabled AND forced**. Forced is the half that is usually
missing — without it the table's own owner walks past its policies, and every
check you then write passes unconditionally.

---

## 2. The three product roles

`member`, `admin`, `owner`. That is the whole enum, and **the platform's own
root is deliberately NOT one of them** — it is a separate database role
reached through `require_platform_root`, so no customer's owner can become one
by any UPDATE, however the org is misconfigured.

### member
Their own work, and what the organisation shares. Concretely: read the
directory, the board, meetings, projects they are on, rooms; create and edit
their own tasks; record and own their own calls; set their own preferences,
alarms, signature and voiceprint.

### admin
Everything a member has, plus the organisation: the roster, invitations,
member privileges, the model allow-list, the audit log, projects (creating
one, renaming it, choosing who is on it), the org profile, and the letterhead.

### owner
Everything an admin has. The difference is **rank**, not a longer list: an
admin binds MEMBERS, the owner binds ADMINS, and nobody binds the owner. That
hierarchy is a database function (`actor_outranks`, `role_is_admin`), not a
screen.

### the platform root (us, the vendor)
Creating and suspending organisations, verifying one so its agents may spend,
placing a pending arrival, and the purge. Not reachable from any customer
account.

---

## 3. The named doors

Fifty-eight `security definer` functions exist, and they are the **only** way
past a policy. Each one is granted to exactly one role. That is the shape this
schema prefers over widening a policy: a door has a name, a signature, an
argument list you can read, and an audit line — a widened policy has none of
those.

Worth knowing by name:

- `soft_delete_call` / `restore_call` — a record's deletion (M11). No app role
  can write `deleted_at` directly, admins included.
- `vendor_set_org_status`, `vendor_accept_org` — vendor-only, both directions
  through one door (D27: any transition that removes the actor's power to
  reverse it needs its exit built with its entrance).
- `tombstone_user`, `delete_person`, `delete_task`, `delete_summary_version` —
  the four destructive acts a person can make, each with its own wall.
- `platform_*` (21 of them) — the console's, root-only.
- `redeem_invitation`, `redeem_telegram_link` — the two "prove it is you"
  doors.

---

## 4. What `echo_app` may DELETE — the closed list

19 tables, and the list is closed by a test (`db/test/50`) that fails if it
grows without an argument:

```
call_note, chat_channel_member, chat_reaction, join_invite, meeting,
meeting_attachment, meeting_attendee, meeting_item, meeting_signature,
project, project_member, reminder, task_assignee, task_checklist_item,
task_label, task_label_link, telegram_identity, telegram_link_code,
user_signature
```

Everything else a customer can "delete" is a soft delete or belongs to
`echo_purge` alone. The point of a closed list is that adding to it is a
decision somebody has to write a sentence about.

---

## 5. What the agent's own role may do

`echo_agent` holds **SELECT on 43 tables and INSERT on 8**, and **no UPDATE
and no DELETE anywhere**. The eight inserts are: `agent_run`, `summary`,
`call_speaker`, `chat_message`, `chat_mention`, `mail_draft`, `meeting_item`,
`person`.

This is M3 as a grant set rather than a promise: "the agent borrows the
caller's authority and never more" is enforced by the database, so a prompt
that talks an agent into deleting something meets a refusal it cannot argue
with. Everything an agent *appears* to change — a task, a project, a message —
is a **client tool**: it runs in the person's own browser, under their own
identity, behind a consent card that names the object.

---

## 6. The walls we ruled, asked of the catalogue

Each of these was a decision recorded in the project's history. Each was asked
of the live database today:

| Ruled | In force |
|---|---|
| No app role bypasses RLS | yes |
| The agent holds no DELETE anywhere (M3) | yes |
| Org status is vendor-only (D27, 0052) | yes |
| A record's soft delete goes through a named door (M11, 0032) | yes |
| Member privileges are bound by the rank above (0101) | yes |
| A project is admin-written and member-read (0186) | yes |
| An alarm is own-only in every direction (0231) | yes |
| The agent cannot write a person's alarms (0231) | yes |
| An unverified org cannot spend a model call (0224) | yes |
| The two shipped agents differ in what they may DO (0233) | yes |

**One of these reported NO on the probe's first run and the probe was wrong,**
which is worth recording because it is the failure mode of every report like
this one: `soft_delete_call` has two overloads, so counting catalogue rows gave
three where the check expected two, and a wall that is in force was reported
broken. A count over the catalogue is a fact about how a function is spelled
wearing the costume of a fact about the wall. Fixed to count distinct names,
and the incident is in the probe's own comment so the next person to widen it
knows.

---

## 7. What CHANGED today, and why it was worth changing

The menus offered what the viewer could not open. A member saw Management ·
member access, invitations, users and the organisation's own page, pressed
one, and met a card saying it is for admins.

**Nothing was ever exposed.** Every one of those pages refused a member the
day it shipped, and core + RLS refused underneath. What was wrong is that the
product advertised four doors and opened one, which teaches a person that the
navigation does not mean anything.

Now: the Management menu shows a member only Speakers (a voice print is a fact
about a colleague and the directory is theirs to read), and Settings hides
Models and Audit logs. Both panes read one shared hook, because fixing the
reported screen alone would have left Settings doing the same thing one menu
over.

**This is a CURTAIN and it is allowed to be one.** `web/src/lib/viewer.ts`
says so in its own header: every rule it draws is enforced twice underneath,
so a stale or wrong answer there costs a menu entry and never a row. It is
never the thing standing between a member and a surface.

The other half of the directive — "admins can see it but they cannot see the
admins page of it" — was already true, and true on the SERVER: an admin's
`/v1/privileges` response simply contains no admin rows (a 2026-08-26 ruling:
"it does not feel right that an admin sees their own privileges"). The screen
has nothing to hide because it was never sent anything to hide.

---

## 8. The honest gaps

Said plainly rather than left for somebody to discover:

1. **A member can still reach an admin page by typing its URL** and will get
   the refusal card. That is correct behaviour, not a gap — but it means the
   menu change is cosmetic by design, and anybody auditing this should audit
   the server, not the menu.
2. **`assistant_agent.tools` is not a ceiling** on what an agent may do and
   has not been since 2026-09-04. Its comment now says so in the database.
   The web still falls back to it when an older core sends no capability list.
3. **Suspended members keep reading their own alarms.** Deliberate (0232):
   they are their own rows, `actor_id()` is still the wall, and somebody
   locked out mid-day should not also have their own list vanish.
4. **The purge's table list is enumerated**, so a new org-scoped table has to
   be added to it. A derived coverage check (db/test/102) fails when one is
   not — that is the instrument, and it has caught this twice.

---

*Re-run the readings: `node db/scripts/probe-roles.mjs` from `db/`.*
