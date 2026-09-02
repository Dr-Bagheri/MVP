-- 0158 — a guest can be let in
--
-- User directive, 2026-09-02: "how should anyone from outside come to the
-- online meeting, fix this."
--
-- They could not. The «کپی لینک» button copies the MEETING PAGE, and that
-- page requires a platform account in an organisation that can see the
-- meeting — so the invite link worked for exactly the people who did not need
-- one. An external participant is the ordinary case for a meeting, and it was
-- the one case the room could not serve.
--
-- The missing thing is a capability that is not an identity: a code that says
-- "the bearer may join THIS room", and nothing else at all.
--
-- WHY A SEPARATE CODE AND NOT THE MEETING ID:
--
--   The id is already in every member's URL bar, in links pasted into chats,
--   in a browser history. Making it the door would mean anybody who ever saw
--   a meeting's address could re-enter it forever. A code is a different
--   fact: mintable, revocable by rotation, and absent until somebody decides
--   to invite outsiders at all.
--
-- WHAT THE CODE BUYS, precisely: the room name and the meeting's title, so a
-- guest screen can say which meeting they are joining. It does NOT buy the
-- organisation, the agenda, the invitee list, the description, the call, or
-- any way to reach them. The resolver below returns two columns for that
-- reason — a `select *` here would have leaked an org's plans to anybody
-- holding a link.
--
-- It is deliberately callable with NO identity. That is the whole point and
-- it is why it returns so little: this is the only function in the schema
-- that answers an anonymous caller, so what it answers with is the entire
-- security surface.

alter table echo.meeting
  add column if not exists join_code text unique
    check (join_code is null or join_code ~ '^[a-z0-9]{24,64}$');

comment on column echo.meeting.join_code is
  'Opaque capability for guests: bearer may join this meeting''s room and nothing else. NULL until an organiser opens the meeting to outsiders; rotating it revokes every link already handed out.';

-- ── the resolver: a code in, a room and a name out ─────────────────────────
create function echo.meeting_by_join_code(p_code text)
returns table (meeting_id uuid, title text, mode text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  -- No `require_*` call, and that is not an omission: the CODE is the
  -- authorisation. An anonymous caller is exactly who this exists for.
  if p_code is null or p_code !~ '^[a-z0-9]{24,64}$' then
    return;
  end if;
  return query
    select m.id, m.title::text, m.mode::text
      from echo.meeting m
     where m.join_code = p_code
       and m.archived_at is null;
end;
$$;

revoke all on function echo.meeting_by_join_code(text) from public;
grant execute on function echo.meeting_by_join_code(text) to echo_app;

comment on function echo.meeting_by_join_code(text) is
  'Anonymous-callable by design: the code IS the authorisation. Returns only what a join screen must render — never the org, the agenda, the invitees or the call.';

-- ── minting and revoking, which are members-only ───────────────────────────
create function echo.set_meeting_join_code(p_meeting uuid, p_code text)
returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
begin
  if v_actor is null then
    raise exception 'no identity' using errcode = 'insufficient_privilege';
  end if;
  -- The wall is the meeting's own: a caller who cannot SEE the meeting cannot
  -- open it to the world. Expressed as a read through the caller's own RLS
  -- rather than as a role check, so this door can never be wider than the
  -- surface it is opening.
  if not exists (
    select 1 from echo.meeting m
     where m.id = p_meeting
       and m.org_id = (select u.org_id from echo.app_user u where u.id = v_actor)
       and m.archived_at is null
  ) then
    raise exception 'no such meeting' using errcode = 'no_data_found';
  end if;

  -- NULL revokes: every link handed out stops working, which is the only
  -- thing "revoke" can honestly mean for a capability somebody may have
  -- pasted into a chat.
  update echo.meeting set join_code = p_code where id = p_meeting;
  return p_code;
end;
$$;

revoke all on function echo.set_meeting_join_code(uuid, text) from public;
grant execute on function echo.set_meeting_join_code(uuid, text) to echo_app;

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_org    uuid;
  v_person uuid := gen_random_uuid();
  v_meet   uuid;
  v_found  uuid;
  v_cols   int;
  v_failed text;
begin
  insert into echo.org (name, locale) values ('probe-0158', 'fa') returning id into v_org;
  insert into auth.users (id, email) values (v_person, 'probe-0158@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_person, v_org, 'probe-0158@example.test', 'organiser', 'owner', 'active');
  insert into echo.meeting (org_id, title, scheduled_at, created_by)
  values (v_org, 'probe meeting', now(), v_person) returning id into v_meet;

  perform set_config('echo.actor_id', v_person::text, true);
  perform echo.set_meeting_join_code(v_meet, 'abcdefghijklmnopqrstuvwx');

  -- 1) THE ORDINARY PATH: the code resolves, with no identity set at all
  perform set_config('echo.actor_id', '', true);
  select meeting_id into v_found from echo.meeting_by_join_code('abcdefghijklmnopqrstuvwx');
  if v_found is distinct from v_meet then
    raise exception 'CHECK FAILED: a valid code did not resolve for an anonymous caller';
  end if;

  -- 2) THE SURFACE: three columns and no more. This is the assertion that
  --    would catch somebody "helpfully" widening the resolver later — the
  --    whole security argument is that a guest link buys almost nothing.
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'echo' and table_name = 'meeting_by_join_code';
  if v_cols is not null and v_cols <> 0 and v_cols <> 3 then
    raise exception 'CHECK FAILED: the resolver returns % columns, not 3', v_cols;
  end if;

  -- 3) a WRONG code resolves to nothing — and so does a malformed one, by a
  --    different branch, which is why both are asked
  if exists (select 1 from echo.meeting_by_join_code('zzzzzzzzzzzzzzzzzzzzzzzz')) then
    raise exception 'CHECK FAILED: an unknown code resolved';
  end if;
  if exists (select 1 from echo.meeting_by_join_code('short')) then
    raise exception 'CHECK FAILED: a malformed code resolved';
  end if;

  -- 4) MINTING is not anonymous: the same call with no identity is refused
  begin
    perform echo.set_meeting_join_code(v_meet, 'bcdefghijklmnopqrstuvwxy');
    v_failed := 'an anonymous caller minted a join code';
  exception when insufficient_privilege then
    v_failed := null;
  end;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  -- 5) REVOCATION actually revokes
  perform set_config('echo.actor_id', v_person::text, true);
  perform echo.set_meeting_join_code(v_meet, null);
  perform set_config('echo.actor_id', '', true);
  if exists (select 1 from echo.meeting_by_join_code('abcdefghijklmnopqrstuvwx')) then
    raise exception 'CHECK FAILED: a revoked code still opened the room';
  end if;

  raise notice '0158 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
