-- 0231 — the platform can wake you: a reminder you set, and the ones it works out.
--
-- User directive, 2026-09-18: "i need an alarm system that can be set for the
-- platform, a page in settings that you can set a time for alarm that gives
-- you a notification pop up in the platform if you set it; also agents have
-- access to it to set it for you; also if you have a task that is near its
-- deadline or if you have an upcoming meeting it alarms you; if someone added
-- you for an upcoming meeting in the platform it shows you half an hour
-- before."
--
-- ── ONLY ONE OF THE THREE IS A ROW, and that is the whole design ──────────
--
-- A reminder somebody TYPED is a fact that exists nowhere else: «wake me at
-- 14:30 about the audio dataset» is not derivable from anything, so it is
-- stored. That is `echo.reminder`.
--
-- The other two are NOT stored, and storing them is the obvious mistake this
-- schema is built to avoid. "Your task is due in two hours" and "your meeting
-- starts in thirty minutes" are ALREADY facts in this database —
-- `echo.task.due_at` and `echo.meeting.scheduled_at` — so a worker writing
-- reminder rows ahead of time would create a second copy of a deadline, and
-- the copy would be wrong the moment anybody moved the deadline, cancelled
-- the meeting, finished the task or was removed from the roster. Rule 6: the
-- derived artifact is rebuilt, never stored beside its source. They are
-- computed at read time from the rows that already exist, which is also why
-- "someone added you to a meeting" needs no trigger at all — the moment the
-- attendee row exists, the alarm exists with it.
--
-- ── SO THE ONLY STATE THE DERIVED ONES NEED IS "I SAW THAT" ───────────────
--
-- `echo.reminder_ack` is a person saying they have seen one, keyed by a
-- string the SERVER composes (`task:<id>:<due instant>`). The instant is in
-- the key on purpose: move the deadline and the key changes, so the new
-- deadline alarms again rather than being silently covered by an
-- acknowledgement of the old one. An ack is per PERSON, never per org.
--
-- The alternative was the browser remembering what it had shown. That is a
-- per-device convenience where this is a per-person fact: a reminder you
-- dismissed on your phone must not fire again on your laptop, and a platform
-- that repeats an alarm you answered is one people learn to close without
-- reading.
--
-- ── WHO MAY TOUCH THEM ────────────────────────────────────────────────────
--
-- Both tables are OWN-ONLY, in every direction, by `echo.actor_id()` — the
-- same posture as a voiceprint (0112) and an agent card (0164). An admin
-- cannot read your alarms: a list of what a colleague has asked to be woken
-- about is a diary, and an org's admin has no business in one.
--
-- `echo_agent` gets NO GRANT AT ALL. The user asked for agents to be able to
-- set an alarm, and they can — through the CLIENT tool that runs in the
-- person's own browser under their own authority with a consent card, which
-- is how every other agent write in this product works. A server-side grant
-- would let an unattended run write into a person's alarms with nobody
-- watching, and that is a different feature from the one that was asked for.

begin;

-- ─── the alarm a person (or their agent, through their browser) set ────────
create table echo.reminder (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org (id) on delete cascade,
  -- WHOSE alarm. Not "who created it": an agent acting for you creates it and
  -- it is still yours, and `created_by` below is where that distinction goes.
  user_id     uuid not null,
  at          timestamptz not null,
  -- what to say when it fires. NOT NULL and non-empty: an alarm with no words
  -- is a pop-up that tells a person they have been woken and nothing else.
  label       text not null check (length(btrim(label)) between 1 and 200),
  -- who wrote the row: the person themselves, or the person whose browser an
  -- agent was acting in. Never an agent identity — there is no grant for one.
  created_by  uuid not null,
  dismissed_at timestamptz,
  created_at  timestamptz not null default now(),
  -- the person is in this org: `(id, org_id)` on app_user makes the pair
  -- unrepresentable rather than checked (D9 — structure, not a predicate)
  constraint reminder_user foreign key (user_id, org_id)
    references echo.app_user (id, org_id) on delete cascade
);

-- what the poll asks for, every minute, per person: the undismissed ones that
-- are due. Partial, because a dismissed alarm is never read again.
create index reminder_due_idx on echo.reminder (user_id, at)
  where dismissed_at is null;

comment on table echo.reminder is
  '0231: an alarm a person set for themselves (or their agent set in their '
  'browser, under their authority). Task and meeting alarms are NOT here — '
  'they are computed from due_at and scheduled_at, because a stored copy of '
  'a deadline is wrong the moment the deadline moves.';

alter table echo.reminder enable row level security;
alter table echo.reminder force row level security;

create policy reminder_own_read on echo.reminder
  for select to echo_app using (user_id = echo.actor_id());
create policy reminder_own_write on echo.reminder
  for insert to echo_app with check (
    user_id = echo.actor_id()
    and created_by = echo.actor_id()
    and org_id = echo.actor_org_id()
  );
create policy reminder_own_update on echo.reminder
  for update to echo_app using (user_id = echo.actor_id())
  with check (user_id = echo.actor_id());
create policy reminder_own_delete on echo.reminder
  for delete to echo_app using (user_id = echo.actor_id());

grant select, insert, update, delete on echo.reminder to echo_app;

create policy reminder_purge_read on echo.reminder
  for select to echo_purge using (true);
create policy reminder_purge_delete on echo.reminder
  for delete to echo_purge using (true);
grant select, delete on echo.reminder to echo_purge;

-- ─── "I have seen that one" — for the alarms nothing stores ────────────────
create table echo.reminder_ack (
  org_id  uuid not null references echo.org (id) on delete cascade,
  user_id uuid not null,
  -- the SERVER composes it: `task:<uuid>:<iso instant>`. The instant is part
  -- of the key so that moving a deadline produces a new key and alarms again,
  -- rather than inheriting the acknowledgement of a deadline that no longer
  -- exists.
  key     text not null check (length(key) between 1 and 200),
  at      timestamptz not null default now(),
  primary key (user_id, key),
  constraint reminder_ack_user foreign key (user_id, org_id)
    references echo.app_user (id, org_id) on delete cascade
);

comment on table echo.reminder_ack is
  '0231: a person has seen a COMPUTED alarm (a task deadline, a meeting about '
  'to start). Keyed by the server so that moving the underlying moment makes '
  'a new key and alarms again.';

alter table echo.reminder_ack enable row level security;
alter table echo.reminder_ack force row level security;

create policy reminder_ack_own_read on echo.reminder_ack
  for select to echo_app using (user_id = echo.actor_id());
create policy reminder_ack_own_write on echo.reminder_ack
  for insert to echo_app with check (
    user_id = echo.actor_id() and org_id = echo.actor_org_id()
  );

-- No UPDATE and no DELETE for anybody but the purge, and that is the shape
-- rather than an omission: an ack is a thing that happened at a moment, and
-- "un-seeing" one is not an act this product has. A person who wants the
-- alarm back moves the deadline, which makes a new key.
grant select, insert on echo.reminder_ack to echo_app;

create policy reminder_ack_purge_read on echo.reminder_ack
  for select to echo_purge using (true);
create policy reminder_ack_purge_delete on echo.reminder_ack
  for delete to echo_purge using (true);
grant select, delete on echo.reminder_ack to echo_purge;

-- ─── the purge learns both tables (0145's rule) ────────────────────────────
-- Regenerated from the function's own definition (0132), never retyped; the
-- anchor is found by PATTERN (0226's lesson about the body's padding).
do $regen$
declare
  v_def    text;
  v_anchor text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('echo.reminder' in v_def) > 0 then
    raise exception '0231 FAILED: the purge already names a reminder table — this migration would double it';
  end if;

  -- both hang off app_user, so they go where the other per-person rows go:
  -- before the people themselves are deleted
  v_anchor := (regexp_match(v_def, 'delete from echo\.user_signature\s+where org_id = p_org;'))[1];
  if v_anchor is null then
    raise exception '0231 FAILED: the purge body has moved on — its user_signature line is not where this migration expects it. Re-read the function before editing it.';
  end if;
  v_def := replace(
    v_def, v_anchor,
    '  -- 0231: the alarms a person set and the ones they have acknowledged' || E'\n'
    || '  delete from echo.reminder_ack           where org_id = p_org;' || E'\n'
    || '  delete from echo.reminder               where org_id = p_org;' || E'\n'
    || v_anchor);

  execute v_def;
end
$regen$;

-- ─── what this migration promises, checked here ───────────────────────────
do $check$
declare
  v_def     text;
  v_missing text;
  v_names   text;
begin
  -- the agent holds NOTHING on either table: the alarm an agent sets is set
  -- in the person's browser, under the person's own identity
  select string_agg(distinct c.relname, ', ' order by c.relname) into v_names
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname in ('reminder', 'reminder_ack')
     and has_table_privilege('echo_agent', c.oid, 'select, insert, update, delete');
  if v_names is not null then
    raise exception '0231 FAILED: echo_agent holds a privilege on % — an unattended run must not write a person''s alarms', v_names;
  end if;

  -- nobody may EDIT an acknowledgement, and nobody but the purge may remove
  -- one: "un-seeing" is not an act
  if has_table_privilege('echo_app', 'echo.reminder_ack', 'update')
     or has_table_privilege('echo_app', 'echo.reminder_ack', 'delete') then
    raise exception '0231 FAILED: echo_app can edit or remove an acknowledgement';
  end if;

  -- own-only, on every path, on both tables
  select string_agg(policyname, ',' order by policyname) into v_names
    from pg_policies
   where schemaname = 'echo' and tablename = 'reminder'
     and policyname like 'reminder_own_%'
     and coalesce(qual, '') || coalesce(with_check, '') like '%actor_id()%';
  if v_names <> 'reminder_own_delete,reminder_own_read,reminder_own_update,reminder_own_write' then
    raise exception '0231 FAILED: echo.reminder is not self-scoped on every path (%)', coalesce(v_names, 'none');
  end if;

  -- RLS is FORCED on both (a table owner otherwise walks past its own policies)
  select string_agg(relname, ', ' order by relname) into v_names
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname in ('reminder', 'reminder_ack')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if v_names is not null then
    raise exception '0231 FAILED: RLS is not enabled AND forced on %', v_names;
  end if;

  -- purge coverage, derived from the catalogue (0145's instrument)
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  select string_agg(t.relname, ', ' order by t.relname) into v_missing
    from (
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'echo' and c.relkind = 'r'
         and a.attname = 'org_id' and not a.attisdropped
         and c.relname not in ('deletion_record')
    ) t
   where v_def !~ ('delete from echo\.' || t.relname || '\s');
  if v_missing is not null then
    raise exception '0231 FAILED: platform_purge_org does not delete: % — a purge that raises is a purge that does not run', v_missing;
  end if;

  -- and the DISCRIMINATING half: a loop that passed because it found nothing
  -- to check would pass the line above too
  if v_def !~ 'delete from echo\.reminder_ack\s' or v_def !~ 'delete from echo\.reminder\s+where' then
    raise exception '0231 FAILED: the purge does not name both new tables — the coverage check above had nothing to find';
  end if;
end
$check$;

commit;
