-- 0167 — a message reaches a colleague
--
-- USER DIRECTIVE, 2026-09-03: "they must have the ability to know all members
-- and their roles and if they asked to give messages to some one else in the
-- platform they can".
--
-- The bell already holds durable, server-side cards (0074). What it could not
-- do is carry a card TO somebody: `agent_card_own` requires
-- `owner_id = echo.actor_id()`, so echo_app can write a card for the person
-- making the request and for nobody else. That is the wall working — an app
-- role that can write rows into other people's inboxes is an app role that can
-- be made to spam an organization — so this is a DOOR, not a relaxation.
--
-- `echo.send_member_message` is definer, takes the recipient and the text, and
-- stamps the sender from `echo.actor_id()` rather than from an argument. D29's
-- rule, again: a fact about who acted must not be supplyable by the actor.
--
-- What it will not do:
--   · reach outside the org — both parties are re-read from app_user and must
--     share `org_id`, which is checked here rather than trusted from the
--     caller's claim about who they are messaging;
--   · reach an inactive person — a suspended colleague's inbox is not a
--     letterbox, and "delivered" about a message nobody will ever open is the
--     wrong kind of success;
--   · reach anybody at all from echo_agent. The grant is echo_app's alone.
--     The agent PROPOSES a message; the browser sends it under the person's
--     own session after they approve it, which is what makes "the agent
--     borrows the caller's authority and never more" true here rather than
--     merely intended.

begin;

-- ── the kind, and the two columns a message needs ──────────────────────────
alter table echo.agent_card
  drop constraint agent_card_kind_check,
  add constraint agent_card_kind_check
  check (kind in ('post_call_brief', 'weekly_digest', 'workflow_result',
                  'mail_draft', 'meeting_prep', 'member_message'));

alter table echo.agent_card
  -- who sent it. NULL for every card the platform makes on its own, which is
  -- the honest reading: a weekly digest has no sender, and a message does.
  add column if not exists from_user_id uuid,
  -- the message itself. Every other kind's content lives in the conversation
  -- the card points at; a message has no conversation, so it carries its text.
  -- Bounded here rather than only in the api: the constraint is the enforcer
  -- and the api's check is the same sentence said earlier.
  add column if not exists body text not null default ''
    check (length(body) <= 2000);

-- D9 again: a sender in another org is structurally impossible, not merely
-- refused by the function that happens to be the only writer today.
alter table echo.agent_card
  add constraint agent_card_sender_same_org
  foreign key (from_user_id, org_id) references echo.app_user (id, org_id);

comment on column echo.agent_card.from_user_id is
  '0167: the colleague who sent this, for kind = member_message. NULL for every card the platform generates — a digest has no sender.';
comment on column echo.agent_card.body is
  '0167: the message text, for kind = member_message. Other kinds keep their content in the conversation session_id points at.';

-- ── the door ───────────────────────────────────────────────────────────────
create or replace function echo.send_member_message(p_to uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from uuid := echo.actor_id();
  v_org  uuid := echo.actor_org_id();
  v_body text := btrim(p_body);
  v_id   uuid;
begin
  if v_from is null or v_org is null then
    raise exception 'no actor' using errcode = '42501';
  end if;
  if not echo.actor_is_active() then
    raise exception 'sender is not an active member' using errcode = '42501';
  end if;
  if v_body = '' or length(v_body) > 2000 then
    raise exception 'a message must be 1-2000 characters' using errcode = '22023';
  end if;
  if p_to = v_from then
    -- Not a safety rule; a product one. A note to yourself is a task, and the
    -- platform has tasks. Refusing it keeps the bell meaning "somebody sent
    -- you this".
    raise exception 'cannot send a message to yourself' using errcode = '22023';
  end if;

  -- The recipient is verified against app_user, never taken on the caller's
  -- word: this function runs as its owner, so the RLS that would normally
  -- answer "no such person" is not in the way and the check has to be here.
  if not exists (
    select 1 from echo.app_user u
     where u.id = p_to and u.org_id = v_org and u.status = 'active'
  ) then
    -- One answer for "not in your organization", "suspended" and "no such
    -- id" — deliberately. Distinguishing them turns this into an oracle for
    -- who exists on the platform, and the caller can already see every
    -- colleague they are allowed to see through the members list.
    raise exception 'no such recipient' using errcode = '22023';
  end if;

  insert into echo.agent_card (org_id, owner_id, kind, title, body, from_user_id)
  values (v_org, p_to, 'member_message', '', v_body, v_from)
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function echo.send_member_message(uuid, text) from public;
grant execute on function echo.send_member_message(uuid, text) to echo_app;

comment on function echo.send_member_message(uuid, text) is
  'D8 door (0167): one active member sends another a message, which lands as a bell card. Sender is echo.actor_id(), never an argument. echo_app only — the agent proposes a message and the person''s own session sends it.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_a uuid; v_b uuid; v_org uuid; v_card uuid; v_failed boolean;
begin
  -- the grant is exactly one role's
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     join pg_roles r on r.oid = a.grantee
    where n.nspname = 'echo' and p.proname = 'send_member_message'
      and a.privilege_type = 'EXECUTE'
      and r.rolname in ('echo_agent', 'echo_purge', 'public')
  ) then
    raise exception 'CHECK FAILED: send_member_message is granted beyond echo_app';
  end if;

  select u.org_id into v_org from echo.app_user u where u.status = 'active'
   group by u.org_id having count(*) >= 2 limit 1;
  if v_org is null then
    raise notice '0167: no org with two active members in this database — the behavioural checks did not run, result unknown';
    return;
  end if;
  select id into v_a from echo.app_user where org_id = v_org and status = 'active' order by id limit 1;
  select id into v_b from echo.app_user where org_id = v_org and status = 'active' and id <> v_a order by id limit 1;

  perform set_config('echo.actor_id', v_a::text, true);
  perform set_config('echo.actor_org_id', v_org::text, true);

  -- the ordinary path: a real card lands, addressed to the colleague and
  -- stamped with the sender. The whole matrix, not just the refusals.
  v_card := echo.send_member_message(v_b, 'سلام');
  if not exists (
    select 1 from echo.agent_card
     where id = v_card and owner_id = v_b and from_user_id = v_a
       and kind = 'member_message' and body = 'سلام' and read_at is null
  ) then
    raise exception 'CHECK FAILED: the message did not land as an unread card for the recipient';
  end if;

  -- and the refusals
  v_failed := false;
  begin perform echo.send_member_message(v_a, 'به خودم'); exception when others then v_failed := true; end;
  if not v_failed then raise exception 'CHECK FAILED: a message to oneself was accepted'; end if;

  v_failed := false;
  begin perform echo.send_member_message(v_b, '   '); exception when others then v_failed := true; end;
  if not v_failed then raise exception 'CHECK FAILED: an empty message was accepted'; end if;

  v_failed := false;
  begin perform echo.send_member_message(gen_random_uuid(), 'به هیچ‌کس');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'CHECK FAILED: a message to a stranger was accepted'; end if;

  delete from echo.agent_card where id = v_card;
  perform set_config('echo.actor_id', '', true);
  perform set_config('echo.actor_org_id', '', true);
end $chk$;

commit;
