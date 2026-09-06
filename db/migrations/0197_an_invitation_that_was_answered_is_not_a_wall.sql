-- 0197 — an invitation that was answered is not a wall, and another admin may
-- take one back.
--
-- 0189's `unique (kind, target_id, invitee_id)` covered EVERY state. Once
-- carol declined a room (or accepted and later left), no one could ever
-- invite her to that room again: `invite()` inserts `on conflict do nothing`,
-- so «دعوت همه» answered `invited: 0` — no error, no row, forever, and the
-- admin pressing it learned nothing. Found by the 2026-09-06 check-up.
--
-- What must be unique is ONE LIVE invitation per person per target. Decided
-- rows are facts (who was asked, what they said, when) and stay; a fresh
-- pending row may follow them. So the constraint becomes a partial unique
-- index on `state = 'pending'`. `on conflict do nothing` with no target still
-- honours a partial unique index, so core's insert is unchanged.
--
-- And `join_invite_withdraw` admitted only the inviter: a second admin
-- withdrawing a colleague's invitation matched zero rows, and core's DELETE
-- carried no RETURNING, so it answered 204 for anybody — a refusal wearing a
-- success. Admins may withdraw any invitation in their org now; core reads
-- RETURNING and answers 404 when nothing moved.

begin;

do $mig$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'echo.join_invite'::regclass
     and contype = 'u'
     and conkey = (select array_agg(attnum order by attnum)
                     from pg_attribute
                    where attrelid = 'echo.join_invite'::regclass
                      and attname in ('kind', 'target_id', 'invitee_id'));
  if v_name is null then
    raise exception '0197: the all-states unique on join_invite was not found — the premise changed';
  end if;
  execute format('alter table echo.join_invite drop constraint %I', v_name);
end $mig$;

create unique index join_invite_one_pending
  on echo.join_invite (kind, target_id, invitee_id)
  where state = 'pending';

drop policy join_invite_withdraw on echo.join_invite;
create policy join_invite_withdraw on echo.join_invite
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (invited_by = echo.actor_id() or echo.actor_is_admin()));

-- ── self-check: a decided row does not block a new one; two pending do collide ──
do $chk$
declare
  v_org   uuid;
  v_alice uuid;
  v_bob   uuid;
  v_room  uuid;
  v_first uuid;
  v_dup   boolean := false;
begin
  select u.org_id, u.id into v_org, v_alice
    from echo.app_user u where u.status = 'active' order by u.created_at limit 1;
  select u.id into v_bob
    from echo.app_user u where u.status = 'active' and u.org_id = v_org and u.id <> v_alice
    order by u.created_at limit 1;
  if v_org is null or v_bob is null then
    raise notice '0197: fewer than two active members in one org — index installed, path unproven here';
    return;
  end if;
  insert into echo.chat_channel (org_id, name, created_by)
  values (v_org, '__0197_probe__', v_alice) returning id into v_room;
  insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by, state, responded_at)
  values (v_org, 'chat_channel', v_room, v_bob, v_alice, 'declined', now()) returning id into v_first;
  /* a fresh pending invitation after a decline: allowed */
  insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
  values (v_org, 'chat_channel', v_room, v_bob, v_alice);
  /* a second pending one: still one live invitation per person per target */
  begin
    insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
    values (v_org, 'chat_channel', v_room, v_bob, v_alice);
  exception when unique_violation then
    v_dup := true;
  end;
  if not v_dup then
    raise exception 'CHECK FAILED: two pending invitations for one person and one room were accepted';
  end if;
  delete from echo.join_invite where target_id = v_room;
  delete from echo.chat_channel where id = v_room;
end $chk$;

commit;
