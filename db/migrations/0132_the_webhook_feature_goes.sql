-- 0132 — the webhook feature is removed.
--
-- User directive, 2026-08-29: "i dont need the webhook, and the others that
-- are not already being used as well".
--
-- ── why this is a deletion and not a deprecation ─────────────────────────
-- The feature was never reachable end to end, and the catalogue says so
-- rather than anyone's memory:
--
--   echo.webhook               0 rows
--   echo.webhook_delivery      0 rows
--   pgmq echo_deliver_webhook  total_messages 0   (it never carried one)
--
-- The last number is the load-bearing one. The dispatcher (M17's fourth
-- worker handler) was written, tested, signed and reviewed — and never
-- registered in runner.ts, so nothing ever consumed that queue. A drain
-- created through Settings would have written a row, enqueued a delivery and
-- waited forever. That is rule 13½ at feature scale: a producer with no
-- consumer, invisible from the side that built the producer. The honest
-- thing to do with a doorbell nobody answers is take it off the wall.
--
-- ── what leaves with it ─────────────────────────────────────────────────
-- Both tables, their six policies, the created_by immutability trigger
-- (0030), and the `subscribed_webhooks` scoped read (0026/D19 — the
-- enqueuer's only door, and the enqueuer is gone). `WEBHOOK_EVENTS` leaves
-- core/'s vocabulary in the same commit; the four spellings it shared with
-- M41's trigger set survive there, where they have real emitters.
--
-- ── the one thing that must NOT leave ───────────────────────────────────
-- `platform_purge_org` deletes from both tables. Dropping them under it
-- would leave the purge referring to relations that no longer exist — and a
-- purge that raises is a purge that does not run, on the one path in the
-- product where failing to delete is the worst possible outcome. So it is
-- recreated here without those two statements, in the same transaction as
-- the drop.
--
-- The body below is the LIVE definition (`pg_get_functiondef`) with exactly
-- those two lines filtered out, generated rather than retyped. The first
-- attempt at this file was hand-written from memory and had a one-argument
-- signature, the wrong guard and half the delete list missing — which
-- `create or replace` would have installed as a SECOND overload beside the
-- real one rather than failing. Hence the assertions at the foot: the
-- recreated function must still take three arguments, must no longer
-- mention a webhook, and must still name the tables a purge exists to
-- empty. Copying is safe only when something checks the copy.
--
-- ── inbound references ──────────────────────────────────────────────────
-- Checked on the live catalogue: no foreign key from any non-webhook table
-- points at either of these two. They reference each other and nothing else
-- references them.

begin;

-- ── the feature's own objects ───────────────────────────────────────────

drop function if exists echo.subscribed_webhooks(text);

drop trigger if exists webhook_created_by_immutable on echo.webhook;
drop function if exists echo.tg_webhook_created_by_immutable();

drop table if exists echo.webhook_delivery;
drop table if exists echo.webhook;

-- The queue. `purge_queue` first so the drop cannot fail on a message that
-- arrived between the count above and this statement — it holds none, and
-- purging an empty queue costs nothing.
select pgmq.purge_queue('echo_deliver_webhook');
select pgmq.drop_queue('echo_deliver_webhook');

-- ── platform_purge_org, minus the two statements ────────────────────────

CREATE OR REPLACE FUNCTION echo.platform_purge_org(p_actor uuid, p_org uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason  text;
  v_deleted timestamptz;
  v_name    text;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.deleted_at, o.name into v_deleted, v_name
    from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    raise exception 'only a deleted organization can be purged'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from echo.platform_operator po
      join echo.app_user u on u.id = po.user_id
     where u.org_id = p_org
  ) then
    raise exception 'an organization holding a platform root is not purged; revoke the root first'
      using errcode = 'insufficient_privilege';
  end if;

  -- sever the ledger's references AND declare why (0084): the rows stay,
  -- their subject is gone, and target_purged is the named reason
  update echo.platform_audit
     set target_user_id = null, target_purged = true
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit
     set target_org_id = null, target_purged = true
   where target_org_id = p_org;

  -- 0132: the two deletes for the removed outbound-delivery feature stood
  -- here. They are named in this file's header, not here — the check at the
  -- foot asserts this body mentions that feature NOWHERE, and it fired on
  -- its first run against an earlier version of this very comment, which
  -- spelled the table names. An absolute check that cannot rot is worth
  -- more than a comment that repeats what the header already says.
  delete from echo.transcript_segment     where org_id = p_org;
  delete from echo.summary                where org_id = p_org;
  delete from echo.call_speaker           where org_id = p_org;
  delete from echo.call_note              where org_id = p_org;
  delete from echo.call_part              where org_id = p_org;
  delete from echo.agent_message_feedback f using echo.agent_message m
    where f.message_id = m.id and m.org_id = p_org;
  delete from echo.agent_message          where org_id = p_org;
  delete from echo.agent_session_share sh using echo.agent_session s
    where sh.session_id = s.id and s.org_id = p_org;
  delete from echo.agent_session          where org_id = p_org;
  delete from echo.agent_card             where org_id = p_org;
  delete from echo.agent_rule             where org_id = p_org;
  delete from echo.proposal_decision      where org_id = p_org;
  delete from echo.agent_run              where org_id = p_org;
  delete from echo.assistant_agent        where org_id = p_org;
  delete from echo.api_key                where org_id = p_org;
  delete from echo.invitation             where org_id = p_org;
  delete from echo.skill                  where org_id = p_org;
  delete from echo.person                 where org_id = p_org;
  delete from echo.connector_secret       where org_id = p_org;
  delete from echo.connector_connection   where org_id = p_org;
  delete from echo.workflow_template      where org_id = p_org;
  delete from echo.admin_action           where org_id = p_org;
  delete from echo.user_status_history    where org_id = p_org;
  delete from echo.call                   where org_id = p_org;
  delete from echo.app_user               where org_id = p_org;
  delete from echo.org                    where id = p_org;

  -- the purge's own entry: no target CAN exist — the declaration carries it
  insert into echo.platform_audit (actor_id, action, target_user_id, target_org_id, target_purged, reason)
  values (p_actor, 'org_purged', null, null, true,
          v_reason || ' [organization: ' || v_name || ']');
  return true;
end;
$function$;

-- ── the copy checks itself ──────────────────────────────────────────────
do $check$
declare
  v_def text;
  v_args integer;
begin
  select pg_get_functiondef(p.oid), p.pronargs into v_def, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if v_args is distinct from 3 then
    raise exception 'platform_purge_org should take 3 arguments, found %', v_args;
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_purge_org') <> 1 then
    raise exception 'platform_purge_org has an overload — the wrong signature was installed beside the right one';
  end if;
  if v_def ~* 'webhook' then
    raise exception 'platform_purge_org still mentions a webhook';
  end if;
  -- a sample of what a purge must still empty; if the copy lost the body,
  -- these are the lines whose absence would only show at purge time
  if v_def !~ 'delete from echo\.call\y'
     or v_def !~ 'delete from echo\.app_user\y'
     or v_def !~ 'delete from echo\.agent_message\y'
     or v_def !~ 'delete from echo\.connector_secret\y'
     or v_def !~ 'insert into echo\.platform_audit' then
    raise exception 'platform_purge_org lost part of its body in the copy';
  end if;
end
$check$;

commit;
