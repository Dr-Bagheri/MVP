-- 0229 — the minutes are SIGNED by the people who were in the room.
--
-- User directive, 2026-09-17: "add place at the end of the summary that each
-- attendant can add their own signature there, so when the meeting ends all
-- the ones that were in it, in their own accounts in the system, can go to
-- the meeting and in the summary part add their own signature — and in the
-- end, when the host is printing it, all of their real signatures that were
-- uploaded in jpg or png are already added there."
--
-- TWO TABLES, because two facts.
--
-- `user_signature` is a PERSON'S signature on file — the picture of their
-- hand, uploaded once in their own profile. It is read and written by exactly
-- one identity: its owner. Nobody else in the organisation can fetch it, an
-- admin included, because the picture of a signature is the one thing about
-- a person that must not be lying around for somebody to paste under a
-- sentence they never agreed to.
--
-- `meeting_signature` is that picture PLACED ON A MEETING — a snapshot of the
-- bytes at the moment of signing, keyed (meeting, person). A snapshot and not
-- a pointer, deliberately: a signature on a record is what was signed with
-- at the time, and a person who later uploads a different picture must not
-- silently re-sign every meeting in their history. It is readable by
-- everybody who can read the meeting (0145: every active member), because
-- the host prints the document and the document carries the signatures — the
-- act of signing IS the act of showing.
--
-- WHY NOT 0146. The meeting row already carries `minutes_signatures`, a jsonb
-- of NAMES appended by anybody who holds the meeting's org-wide UPDATE — the
-- retired lifecycle's «امضا» step, which 2026-09-09 stopped rendering. A
-- signature that any colleague can append in anybody's name is a name in a
-- list, not a signature. This table's insert policy names the actor on the
-- row it writes, so "somebody signed for me" is unrepresentable rather than
-- forbidden by convention. 0146's columns stay where they are, unread.
--
-- WHO MAY SIGN: the host and the roster (db/0202's `meeting_attendee`) — the
-- people in the room. Asked through a DEFINER helper rather than an EXISTS in
-- the policy (rule 11's author-side corollary, 0227's own `actor_on_project`
-- shape): an EXISTS runs as the caller and silently intersects with the other
-- table's policies, and the day somebody narrows who may read a roster is
-- the day signing would quietly stop for exactly the people it is for.
--
-- ONCE, then WITHDRAWN, never edited: there is no UPDATE grant on a placed
-- signature at all. Re-signing is taking yours back and signing again — two
-- acts a person does on purpose — and a picture that could be swapped under
-- an existing signed_at would make the timestamp a lie.
--
-- RASTER ONLY and small: the picture is inlined as a data URI into the
-- document Word and the print window open (0228's own reasoning for the
-- letterhead), and a signature is a small dark mark on a light ground —
-- a megabyte is a scanned A4 page, which is more than any signature needs.

begin;

-- ─── the person's signature on file ────────────────────────────────────────
create table echo.user_signature (
  user_id    uuid primary key,
  org_id     uuid not null references echo.org(id),
  bytes      bytea not null,
  mime       text not null,
  updated_at timestamptz not null default now(),
  constraint user_signature_user
    foreign key (user_id, org_id) references echo.app_user (id, org_id),
  constraint user_signature_bounded check (octet_length(bytes) <= 1048576),
  constraint user_signature_mime check (mime in ('image/png', 'image/jpeg', 'image/webp'))
);

comment on table echo.user_signature is
  '0229: a person''s handwritten signature as a picture, uploaded in their own profile. Read and written by its owner ALONE — an admin cannot fetch a colleague''s signature. Snapshotted onto a meeting by meeting_signature.';

alter table echo.user_signature enable row level security;
alter table echo.user_signature force row level security;

/* MINE, both ways. Every half names the actor, so a row about anybody else
   is unrepresentable — not a thing a policy elsewhere remembers to refuse. */
create policy user_signature_own_read on echo.user_signature
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id());
create policy user_signature_own_write on echo.user_signature
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and user_id = echo.actor_id());
create policy user_signature_own_update on echo.user_signature
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and user_id = echo.actor_id());
create policy user_signature_own_delete on echo.user_signature
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id());

create policy user_signature_purge_read on echo.user_signature
  for select to echo_purge using (true);
create policy user_signature_purge_delete on echo.user_signature
  for delete to echo_purge using (true);

/* the agent holds NOTHING here: a signature is a person's hand, and no
   run — under anybody's borrowed authority — reads or writes one */
grant select, insert, update, delete on echo.user_signature to echo_app;
grant select, delete on echo.user_signature to echo_purge;

-- ─── who is in the room ───────────────────────────────────────────────────
create function echo.actor_on_meeting(p_meeting uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from echo.meeting m
     where m.id = p_meeting
       and m.org_id = echo.actor_org_id()
       and m.created_by = echo.actor_id()
  ) or exists (
    select 1 from echo.meeting_attendee a
     where a.meeting_id = p_meeting
       and a.org_id = echo.actor_org_id()
       and a.user_id = echo.actor_id()
  );
$$;

revoke all on function echo.actor_on_meeting(uuid) from public;
grant execute on function echo.actor_on_meeting(uuid) to echo_app;

comment on function echo.actor_on_meeting(uuid) is
  '0229: is the acting person the meeting''s host or on its roster (0202)? A definer helper so a write policy can ask it without an EXISTS that runs as the caller (D9, 0227''s shape).';

-- ─── the signature placed on a meeting ─────────────────────────────────────
create table echo.meeting_signature (
  meeting_id uuid not null,
  user_id    uuid not null,
  org_id     uuid not null references echo.org(id),
  /* the SNAPSHOT — what they signed with, at the moment they signed */
  bytes      bytea not null,
  mime       text not null,
  signed_at  timestamptz not null default now(),
  primary key (meeting_id, user_id),
  constraint meeting_signature_meeting
    foreign key (meeting_id, org_id) references echo.meeting (id, org_id) on delete cascade,
  constraint meeting_signature_user
    foreign key (user_id, org_id) references echo.app_user (id, org_id),
  constraint meeting_signature_bounded check (octet_length(bytes) <= 1048576),
  constraint meeting_signature_mime check (mime in ('image/png', 'image/jpeg', 'image/webp'))
);

comment on table echo.meeting_signature is
  '0229: a person''s signature PLACED ON a meeting''s minutes — a snapshot of their user_signature at signing time, keyed (meeting, person). Written only by the signer and only while they are the host or on the roster; read by everybody who can read the meeting, because the printed document carries it.';

alter table echo.meeting_signature enable row level security;
alter table echo.meeting_signature force row level security;

/* READ: everybody who can read the meeting (0145/0202's shape) — the host
   prints the document, and a colleague reading the summary sees who has
   signed it. */
create policy meeting_signature_read on echo.meeting_signature
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/* SIGN: your own signature, on a meeting you are in. Both halves name the
   actor; the third names the room. */
create policy meeting_signature_sign on echo.meeting_signature
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and user_id = echo.actor_id()
              and echo.actor_on_meeting(meeting_id));

/* WITHDRAW: your own, and nobody else's — a host cannot strike a
   colleague's signature off the record, and an admin cannot either. */
create policy meeting_signature_withdraw on echo.meeting_signature
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id());

create policy meeting_signature_purge_read on echo.meeting_signature
  for select to echo_purge using (true);
create policy meeting_signature_purge_delete on echo.meeting_signature
  for delete to echo_purge using (true);

/* no UPDATE, for anybody: a placed signature is withdrawn and placed again,
   never edited under its own timestamp (see the header) */
grant select, insert, delete on echo.meeting_signature to echo_app;
grant select, delete on echo.meeting_signature to echo_purge;

-- ─── the purge learns both tables (0145's rule) ────────────────────────────
-- Regenerated from the function's own definition (0132), never retyped; the
-- anchors are found by PATTERN (0226's lesson about the body's padding).
do $regen$
declare
  v_def    text;
  v_anchor text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('echo.meeting_signature' in v_def) > 0
     or position('echo.user_signature' in v_def) > 0 then
    raise exception '0229 FAILED: the purge already names a signature table — this migration would double it';
  end if;

  -- the placed signatures go before the meetings they hang from, beside the
  -- roster rows that share that position
  v_anchor := (regexp_match(v_def, 'delete from echo\.meeting_attendee\s+where org_id = p_org;'))[1];
  if v_anchor is null then
    raise exception '0229 FAILED: the purge body has moved on — its meeting_attendee line is not where this migration expects it. Re-read the function before editing it.';
  end if;
  v_def := replace(
    v_def, v_anchor,
    '  -- 0229: the signatures placed on the meetings, before the meetings' || E'\n'
    || '  delete from echo.meeting_signature      where org_id = p_org;' || E'\n'
    || v_anchor);

  -- and the signatures on file go before the people they belong to
  v_anchor := (regexp_match(v_def, 'delete from echo\.app_user\s+where org_id = p_org;'))[1];
  if v_anchor is null then
    raise exception '0229 FAILED: the purge body has moved on — its app_user line is not where this migration expects it.';
  end if;
  v_def := replace(
    v_def, v_anchor,
    '  -- 0229: the signatures on file, before the people they belong to' || E'\n'
    || '  delete from echo.user_signature         where org_id = p_org;' || E'\n'
    || v_anchor);
  execute v_def;
end $regen$;

-- ─── self-checks ──────────────────────────────────────────────────────────
-- STRUCTURE ONLY (0228's reasoning): a behaviour check here would have to
-- sign a real meeting as a real person. The matrix — who may place one, who
-- may not, who may withdraw whose — is walked both ways in db/test/132
-- against the fixture, which is also the half that keeps working after
-- somebody edits a policy three migrations from now.
do $check$
declare
  v_def     text;
  v_missing text;
  v_grants  text;
begin
  -- both walls are FORCED
  if not (select relforcerowsecurity from pg_class where oid = 'echo.user_signature'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'echo.meeting_signature'::regclass) then
    raise exception '0229 FAILED: row security is not FORCED on a signature table';
  end if;

  -- the agent role holds nothing on either — asserted on the ACL rather than
  -- the permission-filtered information_schema view (rule 11's catalog form)
  if has_table_privilege('echo_agent', 'echo.user_signature', 'SELECT')
     or has_table_privilege('echo_agent', 'echo.meeting_signature', 'SELECT')
     or has_table_privilege('echo_agent', 'echo.meeting_signature', 'INSERT') then
    raise exception '0229 FAILED: the agent role can reach a signature';
  end if;

  -- no UPDATE on a placed signature, for the product role that writes it
  if has_table_privilege('echo_app', 'echo.meeting_signature', 'UPDATE') then
    raise exception '0229 FAILED: a placed signature can be edited in place';
  end if;

  -- the helper is not PUBLIC's to execute (0204's lesson: a new function is
  -- everybody's by default, and a null ACL means the defaults)
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'actor_on_meeting'
       and (p.proacl is null or has_function_privilege('public', p.oid, 'execute'))
  ) then
    raise exception '0229 FAILED: actor_on_meeting is executable by PUBLIC';
  end if;

  -- the sign policy asks the ROOM and names the ACTOR — on the text the
  -- catalogue holds, because a policy recreated later would not re-run this
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'meeting_signature'
       and policyname = 'meeting_signature_sign'
       and with_check like '%actor_on_meeting%' and with_check like '%actor_id()%'
  ) then
    raise exception '0229 FAILED: meeting_signature_sign does not ask the room and name the actor';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'meeting_signature'
       and policyname = 'meeting_signature_withdraw' and qual like '%actor_id()%'
  ) then
    raise exception '0229 FAILED: meeting_signature_withdraw is not scoped to the signer';
  end if;
  -- and the one on file is the owner's in every direction
  select string_agg(policyname, ',' order by policyname) into v_grants
    from pg_policies
   where schemaname = 'echo' and tablename = 'user_signature'
     and policyname like 'user_signature_own_%'
     and coalesce(qual, '') || coalesce(with_check, '') like '%actor_id()%';
  if v_grants <> 'user_signature_own_delete,user_signature_own_read,user_signature_own_update,user_signature_own_write' then
    raise exception '0229 FAILED: user_signature is not self-scoped on every path (%)', coalesce(v_grants, 'none');
  end if;

  -- a placed signature dies WITH its meeting (a meeting may be deleted by an
  -- app role — 0148 — and a signature on a deleted meeting is a row nobody
  -- can reach)
  if (select confdeltype from pg_constraint where conname = 'meeting_signature_meeting') <> 'c' then
    raise exception '0229 FAILED: meeting_signature_meeting does not cascade';
  end if;

  -- purge coverage, derived from the catalogue (0145's instrument): every
  -- org_id table is named, the two new ones included
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
   -- 0202's own pattern: two tables are deleted through a `using` join and
   -- carry no `where org_id`, so the tighter `where\s+org_id` form reports
   -- them missing (it did, on this migration's first local run)
   where v_def !~ ('delete from echo\.' || t.relname || '\s');
  if v_missing is not null then
    raise exception 'platform_purge_org does not delete: % — a purge that raises is a purge that does not run', v_missing;
  end if;
  -- and in the right ORDER: the placed signatures before the meetings, the
  -- ones on file before the people
  if position('delete from echo.meeting_signature' in v_def)
     > position('delete from echo.meeting ' in v_def) then
    raise exception '0229 FAILED: the purge deletes meetings before the signatures placed on them';
  end if;
  if position('delete from echo.user_signature' in v_def)
     > position('delete from echo.app_user ' in v_def) then
    raise exception '0229 FAILED: the purge deletes people before their signatures on file';
  end if;
end $check$;

commit;
