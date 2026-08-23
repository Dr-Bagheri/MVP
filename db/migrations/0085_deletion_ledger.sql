-- Echo — 0085: the DELETION LEDGER (user directive, 2026-08-23: "for all
-- delete buttons in platform and platform control ask of confirm again and
-- reason to log, specially for records").
--
-- The platform CONTROL already takes a reason on every action (0066's
-- dialog + audit). This is the PRODUCT side — and it is the surface M11's
-- amendment deferred on record: "member deletion events get their own
-- metadata-only record surface … the row's content purges; the fact of a
-- deletion is not content." Now built, generalized to the three product
-- deletions: a record (call), a directory person, a member.
--
-- Metadata-only, as ruled: actor, kind, target id, the actor's own reason
-- sentence, timestamp. No titles, no names, no content. The target id is
-- a PLAIN uuid — severable by construction: the ledger outlives whatever
-- it records the deletion of. Reads are the ADMINS' (the compliance feed);
-- writes happen only inside the definer doors below — the reason arrives
-- through the same transaction as the deletion it explains, so the ledger
-- can never disagree with the world (the admin_action tx lesson).

create table echo.deletion_record (
  id         uuid primary key default gen_random_uuid(),
  -- cascade: an org purge (0083) removes members before the org row, and
  -- this ledger is org-scoped content in that sense — it goes with the org
  org_id     uuid not null references echo.org(id) on delete cascade,
  actor_id   uuid not null references echo.app_user(id) on delete cascade,
  kind       text not null check (kind in ('call', 'person', 'member')),
  target_id  uuid,
  reason     text not null check (length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create index deletion_record_org_idx on echo.deletion_record (org_id, created_at desc);

comment on table echo.deletion_record is
  'The product''s deletion ledger (0085, the M11-deferred surface): actor, kind, severable target id, the actor''s reason. Metadata only; written inside the deletion doors, read by admins.';

alter table echo.deletion_record enable row level security;

-- admins read their org's ledger; nobody inserts directly (doors only)
create policy deletion_record_read on echo.deletion_record
  for select to echo_app
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and echo.actor_is_admin()
  );

grant select on echo.deletion_record to echo_app;

-- ─── the reasoned doors: WRAPPERS around the existing walls ────────────────
-- Each calls the original function (its checks re-run unchanged — same
-- actor context, same refusals) and records only when a deletion actually
-- happened. The one-argument forms stay: SQL-internal callers (tombstone's
-- own call loop) and idempotence semantics are untouched.

create function echo.soft_delete_call(p_call uuid, p_reason text)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_org uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  select c.org_id into v_org from echo.call c where c.id = p_call;
  if echo.soft_delete_call(p_call) then
    insert into echo.deletion_record (org_id, actor_id, kind, target_id, reason)
    values (v_org, echo.actor_id(), 'call', p_call, btrim(p_reason));
    return true;
  end if;
  return false; -- already deleted: idempotent, and no second ledger line
end;
$$;

create function echo.delete_person(p_person uuid, p_reason text)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_org uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  select p.org_id into v_org from echo.person p where p.id = p_person;
  perform echo.delete_person(p_person); -- raises on refusal, deletes on success
  insert into echo.deletion_record (org_id, actor_id, kind, target_id, reason)
  values (v_org, echo.actor_id(), 'person', p_person, btrim(p_reason));
  return true;
end;
$$;

create function echo.tombstone_user(p_user uuid, p_reason text)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_org uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  select u.org_id into v_org from echo.app_user u where u.id = p_user;
  if echo.tombstone_user(p_user) then
    insert into echo.deletion_record (org_id, actor_id, kind, target_id, reason)
    values (v_org, echo.actor_id(), 'member', p_user, btrim(p_reason));
    return true;
  end if;
  return false; -- already tombstoned: idempotent, no second line
end;
$$;

revoke all on function echo.soft_delete_call(uuid, text) from public;
revoke all on function echo.delete_person(uuid, text) from public;
revoke all on function echo.tombstone_user(uuid, text) from public;
grant execute on function echo.soft_delete_call(uuid, text) to echo_app;
grant execute on function echo.delete_person(uuid, text) to echo_app;
grant execute on function echo.tombstone_user(uuid, text) to echo_app;
