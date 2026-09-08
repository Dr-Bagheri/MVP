-- 0212 — a Persian voice note sent to the bot becomes a card on the board.
--
-- Item 10 of the twenty (2026-09-08 directive). Voice notes are how work is
-- actually handed over here: somebody says a sentence into a phone in a taxi
-- and expects it to have happened. The pieces all exist — the Telegram
-- connector (M49), the transcription lane (M50), `create_task` — and what was
-- missing is the one thing that makes joining them safe.
--
-- ── THE PROBLEM THIS FILE IS MOSTLY ABOUT ─────────────────────────────────
--
-- A Telegram bot answers ANYBODY. Its username is discoverable, and a stranger
-- who messages it is, to the platform, an integer. The naive version of this
-- feature runs every inbound message as the connection's OWNER (the M35
-- job-identity precedent, which is right for a MAILBOX because a mailbox is
-- already that person's) — and here that would mean: anyone who finds the bot
-- can write cards onto the organisation's board, assign them to real
-- colleagues, and read back the project names in the confirmation.
--
-- So a Telegram sender is NOT a member until they have proved it, and the
-- proof is the ordinary one: a code minted inside the product, where the
-- person is already signed in, sent to the bot from the account they are
-- claiming. What it proves is exactly what is needed — the person holding
-- this Telegram account is the person who was signed in when the code was
-- made — and nothing more.
--
-- Unlinked senders get a sentence explaining how to link and NOTHING is
-- created for them. That refusal is the feature's wall; the model never sees
-- their words at all, so a stranger cannot even spend the organisation's
-- tokens, let alone reach its board.
--
-- ── THE CODE, and why it is stored as a hash ──────────────────────────────
--
-- 0043's invitations settled this: a token that can be redeemed is stored
-- hash-only and shown once. A code that is TYPED INTO A PHONE cannot be 43
-- characters, so this one is short — and every short-code decision below
-- exists to pay for that:
--
--   * 40 bits from an unambiguous alphabet (no O/0, no I/1/l),
--   * fifteen minutes,
--   * ONE live code per person (a partial unique index, not a convention),
--   * single use — redeemed or expired, never both readable and reusable.
--
-- ── WHY THERE IS NO CONSENT CARD ON THE CARD ITSELF ───────────────────────
--
-- The consent card (2026-09-06) exists because an agent proposes a write the
-- person did not ask for in those words. This is the other case: the person
-- recorded a sentence, addressed it to the bot, and pressed send. **The voice
-- note IS the instruction** — the same reasoning as "enrolling is the consent
-- act". What the design owes instead is VISIBILITY: the bot replies with the
-- card it made, in the same thread, within seconds, so a wrong card is seen
-- and fixed by the person who caused it rather than found next week.
--
-- ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────
--
-- It does not keep the audio. The note is fetched, transcribed and dropped;
-- the TEXT becomes the card and the card says where it came from. A stored
-- object with no row pointing at it is a purge problem nobody would remember
-- to solve, and a voice note is not a record of a meeting.

begin;

-- ── the link: one Telegram account, one colleague ─────────────────────────

create table echo.telegram_identity (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),
  user_id      uuid not null,
  /* Telegram's own ids are 64-bit. `chat_id` is where the bot answers: for a
     private chat it equals the user id, and storing it separately means a
     future group chat does not need a schema change to be addressable. */
  telegram_user_id bigint not null,
  chat_id      bigint not null,
  telegram_username text,
  linked_at    timestamptz not null default now(),

  constraint telegram_identity_user_same_org
    foreign key (user_id, org_id) references echo.app_user (id, org_id) on delete cascade,
  /* one Telegram account speaks for one colleague, and one colleague links
     one account. Both directions, because either alone leaves the other
     ambiguous: two people sharing an account, or one person with two voices
     the board cannot tell apart. */
  constraint telegram_identity_one_account_per_org unique (org_id, telegram_user_id),
  constraint telegram_identity_one_per_person      unique (org_id, user_id)
);

comment on table echo.telegram_identity is
  '0212: the proof that a Telegram account belongs to a colleague. Nothing is created on the board for a sender with no row here.';
comment on column echo.telegram_identity.chat_id is
  'Where the bot replies. Equal to telegram_user_id for a private chat; separate so a group chat needs no migration.';

alter table echo.telegram_identity enable row level security;
alter table echo.telegram_identity force row level security;

/* THEIR OWN, and only their own — the same posture as a voiceprint. A link
   is a fact about somebody''s personal messaging account; an admin has no
   product reason to enumerate them, and "an admin can see everything" is
   exactly the courtesy that becomes surveillance (0189''s note about the org
   owner and the room). The worker reads through the definer door below. */
create policy telegram_identity_read_own on echo.telegram_identity
  for select using (org_id = echo.actor_org_id() and user_id = echo.actor_id());
create policy telegram_identity_delete_own on echo.telegram_identity
  for delete using (org_id = echo.actor_org_id() and user_id = echo.actor_id());

grant select, delete on echo.telegram_identity to echo_app;
/* NO INSERT for anybody. A link is minted only by redeeming a code, through
   the door below — so "I linked my own account" cannot be written by hand,
   and neither can "I linked yours". */

-- ── the code that proves it ───────────────────────────────────────────────

create table echo.telegram_link_code (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references echo.org(id),
  user_id    uuid not null,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,

  constraint telegram_link_code_user_same_org
    foreign key (user_id, org_id) references echo.app_user (id, org_id) on delete cascade,
  constraint telegram_link_code_window check (expires_at > created_at)
);

/* ONE LIVE CODE PER PERSON, as an index rather than as a rule somebody has to
   remember. Minting is idempotent-by-replacement (the api deletes the live
   one first), and this is what makes that true instead of hopeful. */
create unique index telegram_link_code_one_live
  on echo.telegram_link_code (org_id, user_id) where redeemed_at is null;
create index telegram_link_code_hash_idx on echo.telegram_link_code (code_hash);

comment on table echo.telegram_link_code is
  '0212: a short, hashed, single-use code a person sends to the bot to prove the account is theirs. Hash-only, 0043''s invitation precedent.';

alter table echo.telegram_link_code enable row level security;
alter table echo.telegram_link_code force row level security;

/* the person may see THAT they have a live code and cancel it; they may never
   read it back — the plaintext existed once, in the response that minted it */
create policy telegram_link_code_read_own on echo.telegram_link_code
  for select using (org_id = echo.actor_org_id() and user_id = echo.actor_id());
create policy telegram_link_code_write_own on echo.telegram_link_code
  for insert with check (org_id = echo.actor_org_id() and user_id = echo.actor_id());
create policy telegram_link_code_drop_own on echo.telegram_link_code
  for delete using (org_id = echo.actor_org_id() and user_id = echo.actor_id());

grant select, insert, delete on echo.telegram_link_code to echo_app;

-- ── the cursor, on the connection that owns it ────────────────────────────

alter table echo.connector_connection
  add column updates_cursor bigint;

comment on column echo.connector_connection.updates_cursor is
  '0212: Telegram''s own update_id offset — the provider''s mechanism, not a second one of ours. Null = never looked; the first look records the mark and acts on nothing.';

-- ── the doors ─────────────────────────────────────────────────────────────
--
-- D8: every definer function is enumerated with its reason. All four exist
-- because the worker has NO identity when it sweeps (`db.withoutIdentity`),
-- and 0130's shape applies to each: if an actor IS set, it must be the owner.

create function echo.due_telegram_polls(p_limit int default 20)
returns table (connection_id uuid, owner_id uuid, org_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select c.id, c.owner_id, c.org_id
    from echo.connector_connection c
    join echo.app_user u on u.id = c.owner_id
   where c.provider = 'telegram'
     and c.status = 'connected'
     and u.status = 'active'
     and (c.polled_at is null or c.polled_at < now() - interval '1 minute')
   order by c.polled_at asc nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

comment on function echo.due_telegram_polls(int) is
  '0212 (D8-enumerated): connected Telegram bots due a look. Ids only — no token, no label. There is deliberately no per-person off-switch: the LINK is the switch, and the bot must be readable before anyone can link through it.';

revoke all on function echo.due_telegram_polls(int) from public;
grant execute on function echo.due_telegram_polls(int) to echo_app;

/* 0111's shape: the due-predicate under the row lock IS the compare-and-set,
   so two workers cannot both claim one bot and answer one voice note twice. */
create function echo.claim_telegram_poll(p_connection uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  update echo.connector_connection
     set polled_at = now()
   where id = p_connection
     and provider = 'telegram'
     and (polled_at is null or polled_at < now() - interval '1 minute')
     and (echo.actor_id() is null or owner_id = echo.actor_id())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

comment on function echo.claim_telegram_poll(uuid) is
  '0212 (D8-enumerated): compare-and-set on polled_at. Two workers cannot both answer one voice note. 0130''s guard: an actor, if set, must own the row.';

revoke all on function echo.claim_telegram_poll(uuid) from public;
grant execute on function echo.claim_telegram_poll(uuid) to echo_app;

create function echo.set_telegram_cursor(p_connection uuid, p_cursor bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection
     set updates_cursor = p_cursor,
         messages_seen = coalesce(messages_seen, 0)
   where id = p_connection
     and provider = 'telegram'
     and (echo.actor_id() is null or owner_id = echo.actor_id());
$$;

comment on function echo.set_telegram_cursor(uuid, bigint) is
  '0212 (D8-enumerated): move the update_id mark. Moves unconditionally after a look — a message we read and declined is still a message we have seen.';

revoke all on function echo.set_telegram_cursor(uuid, bigint) from public;
grant execute on function echo.set_telegram_cursor(uuid, bigint) to echo_app;

/*
 * WHO IS THIS SENDER — the whole security surface, as a SHAPE.
 *
 * It returns two ids and nothing else, so this door cannot be widened by
 * somebody forgetting a filter (0158's rule, and its self-check below). An
 * unknown sender comes back as ZERO ROWS, which is the only answer a stranger
 * ever gets.
 */
create function echo.telegram_identity_for(p_org uuid, p_telegram_user bigint)
returns table (user_id uuid, chat_id bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select i.user_id, i.chat_id
    from echo.telegram_identity i
    join echo.app_user u on u.id = i.user_id
   where i.org_id = p_org
     and i.telegram_user_id = p_telegram_user
     and u.status = 'active'
   limit 1
$$;

comment on function echo.telegram_identity_for(uuid, bigint) is
  '0212 (D8-enumerated): the colleague behind a Telegram sender, in this org, if they are active. Two columns by design — a security surface that is a shape cannot be widened by a forgotten filter (0158).';

revoke all on function echo.telegram_identity_for(uuid, bigint) from public;
grant execute on function echo.telegram_identity_for(uuid, bigint) to echo_app;

/*
 * REDEEM — the only way a link is ever created.
 *
 * `p_code_hash`, not the code: the worker hashes what it read from Telegram
 * and this function compares hashes, so the plaintext is in exactly one
 * place at a time and never in a query the database logs.
 *
 * Refusals are INDISTINGUISHABLE (0043): an unknown code, an expired one and
 * one already spent all return zero rows. "That code was real but you are too
 * late" tells somebody guessing that they are close.
 */
/*
 * The OUT column is `linked_user_id`, not `user_id`, and that is not taste.
 * An OUT parameter is a VARIABLE in the body's scope, so a function returning
 * `user_id` cannot write `where user_id = ...` against a table that also has
 * one — every unqualified use becomes ambiguous and the whole migration
 * refuses to apply. Renaming the OUT is the fix that leaves the SQL readable;
 * `#variable_conflict` would fix it invisibly and change how every other name
 * in the body resolves.
 */
create function echo.redeem_telegram_link(
  p_org uuid, p_code_hash text, p_telegram_user bigint, p_chat bigint, p_username text
) returns table (linked_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code echo.telegram_link_code%rowtype;
begin
  select * into v_code
    from echo.telegram_link_code c
   where c.org_id = p_org
     and c.code_hash = p_code_hash
     and c.redeemed_at is null
     and c.expires_at > now()
   for update;
  if not found then
    return;                                   -- zero rows: the only refusal
  end if;

  update echo.telegram_link_code c set redeemed_at = now() where c.id = v_code.id;

  /* re-linking is a REPLACEMENT, not a second row: somebody who changes phone
     number expects the old link to stop working, and the unique indexes above
     would otherwise refuse them with a constraint error they cannot act on */
  delete from echo.telegram_identity i
   where i.org_id = p_org
     and (i.user_id = v_code.user_id or i.telegram_user_id = p_telegram_user);

  insert into echo.telegram_identity (org_id, user_id, telegram_user_id, chat_id, telegram_username)
  values (p_org, v_code.user_id, p_telegram_user, p_chat, nullif(p_username, ''));

  return query select v_code.user_id;
end $$;

comment on function echo.redeem_telegram_link(uuid, text, bigint, bigint, text) is
  '0212 (D8-enumerated): the ONLY writer of echo.telegram_identity — no role holds INSERT. Single use under a row lock; unknown, expired and spent codes are indistinguishable (0043).';

revoke all on function echo.redeem_telegram_link(uuid, text, bigint, bigint, text) from public;
grant execute on function echo.redeem_telegram_link(uuid, text, bigint, bigint, text) to echo_app;

-- ── the purge learns both tables ──────────────────────────────────────────
--
-- 0145's rule, and the reason it is a rule: thirteen org-scoped tables once
-- went missing from this function at once, so a purge for any org that had
-- used those features RAISED — and a purge that raises is a purge that does
-- not run, on the one path where failing to delete is the worst outcome.
-- The function is REGENERATED from its own definition (0132), never retyped:
-- `create or replace` installs a hand-written near-miss as a SECOND OVERLOAD
-- rather than rejecting it.
do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.project_member         where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its project_member line is not where this migration expects it. Re-read the function before editing it — a substitution that cannot find its anchor must never fall through to a rewrite.';
  end if;
  if position('echo.telegram_identity' in v_def) > 0 then
    raise exception 'the purge already names echo.telegram_identity — this migration has run, or something else added it';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '  delete from echo.telegram_link_code      where org_id = p_org;' || E'\n' ||
    '  delete from echo.telegram_identity       where org_id = p_org;' || E'\n' || v_anchor
  );
  execute v_def;
end $regen$;

-- ── self-checks ───────────────────────────────────────────────────────────
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_def  text;
  v_cols int;
  v_id   uuid;
begin
  -- 1. THE DOOR'S SHAPE. Two columns is the security surface; a third would
  --    be a widening nobody reviewed, so it is asserted rather than trusted.
  select count(*) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proallargtypes, p.proargmodes) as a(t, m) on true
   where n.nspname = 'echo' and p.proname = 'telegram_identity_for' and a.m = 't';
  if v_cols <> 2 then
    raise exception '0212: telegram_identity_for returns % columns, not 2 — the door has been widened', v_cols;
  end if;

  -- 2. NOBODY HOLDS INSERT ON THE LINK. This is the wall: a link exists only
  --    because a code was redeemed. Asserted for both product roles, because
  --    "the app cannot" and "the agent cannot" are different sentences.
  if has_table_privilege('echo_app', 'echo.telegram_identity', 'INSERT')
     or has_table_privilege('echo_agent', 'echo.telegram_identity', 'INSERT') then
    raise exception '0212: a product role can write a link by hand — the code stops proving anything';
  end if;
  -- the discriminating half: a role that can read nothing at all would pass
  -- the line above and be completely wrong
  if not has_table_privilege('echo_app', 'echo.telegram_identity', 'SELECT') then
    raise exception '0212: echo_app cannot read links either — nobody could see their own';
  end if;

  -- 3. THE PURGE NAMES BOTH TABLES.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if position('delete from echo.telegram_identity' in v_def) = 0
     or position('delete from echo.telegram_link_code' in v_def) = 0 then
    raise exception '0212: the purge does not delete the Telegram tables — it would RAISE for any org that used the feature';
  end if;
  -- and it still names what it named before: a regeneration that TRUNCATED
  -- the body would pass the line above and destroy the function
  if position('delete from echo.project_member' in v_def) = 0 then
    raise exception '0212: the regenerated purge lost project_member — the substitution rewrote instead of inserting';
  end if;

  -- 4. RLS IS ON AND FORCED on both. Enabled-but-not-forced is a table the
  --    OWNER walks straight through, which is how a migration's own probe
  --    can certify a wall that is not there.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'echo'
       and c.relname in ('telegram_identity', 'telegram_link_code')
       and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    raise exception '0212: a new table is not behind FORCED row-level security';
  end if;

  -- 5. THE CODE ACTUALLY REDEEMS, ONCE. The accept-half — every assertion
  --    above is about a refusal, and a feature that refuses everybody passes
  --    all of them (rule 7's authorization-matrix corollary).
  select id into v_org from echo.org order by created_at limit 1;
  select id into v_user from echo.app_user where org_id = v_org and status = 'active' limit 1;
  if v_org is not null and v_user is not null then
    insert into echo.telegram_link_code (org_id, user_id, code_hash, expires_at)
    values (v_org, v_user, 'selfcheck-0212-hash', now() + interval '5 minutes');

    select linked_user_id into v_id from echo.redeem_telegram_link(
      v_org, 'selfcheck-0212-hash', 999000000001, 999000000001, 'selfcheck');
    if v_id is distinct from v_user then
      raise exception '0212: a live code did not redeem — the feature refuses everybody';
    end if;

    -- and a SECOND redemption of the same code gets nothing
    select linked_user_id into v_id from echo.redeem_telegram_link(
      v_org, 'selfcheck-0212-hash', 999000000002, 999000000002, 'selfcheck');
    if v_id is not null then
      raise exception '0212: a spent code redeemed twice';
    end if;

    delete from echo.telegram_identity where telegram_user_id in (999000000001, 999000000002);
    delete from echo.telegram_link_code where code_hash = 'selfcheck-0212-hash';
  end if;
end $check$;

commit;
