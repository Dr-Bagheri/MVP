-- 0161 — the item reaches its meeting by structure, not by a subquery
--
-- 0160 shipped its four policies as reads THROUGH the meeting:
--
--     exists (select 1 from echo.meeting m where m.id = meeting_id)
--
-- which is 0159's shape, and 0159 was right to use it — echo_agent holds
-- nothing on meeting_attachment, so the predicate only ever ran as echo_app,
-- which can read echo.meeting. 0160 is the case where that stops being true:
-- the assistant may add an item, and echo_agent holds no SELECT on
-- echo.meeting, so its policy asked a question it is not allowed to ask and
-- the insert died on `permission denied for table meeting` — a refusal that
-- reads like the wall working and is actually the wall misfiring.
--
-- This is the rule-11 author-side corollary, arriving in the migration
-- written the same afternoon as the note about it: "when a policy needs a
-- fact about another protected table, reach for a CONSTRAINT, not a
-- subquery — an EXISTS in a policy runs as the caller and silently
-- intersects with that table's policies; a composite FK makes the wrong
-- state unrepresentable instead. Structure doesn't have the intersection
-- problem; predicates do."
--
-- So: a COMPOSITE foreign key on (meeting_id, org_id) makes attaching an
-- item to another organisation's meeting structurally impossible, and the
-- policies fall back to the org check echo.meeting itself uses (0145:
-- `org_id = actor_org_id() and actor_is_active()`). The item is therefore
-- exactly as visible as the meeting it hangs off — the same promise 0160
-- was making, kept by a constraint instead of a question.

-- the composite target first: a foreign key cannot reference a pair with no
-- unique constraint, and Postgres reports that against the REFERENCED table,
-- which reads as though the wrong table is at fault (0151's note)
alter table echo.meeting
  add constraint meeting_id_org_key unique (id, org_id);

alter table echo.meeting_item
  add constraint meeting_item_same_org
    foreign key (meeting_id, org_id) references echo.meeting (id, org_id)
    on delete cascade;

-- the plain FK is now redundant with the composite one, and two spellings of
-- one rule is the drift shape — drop it (0034's precedent: drop, don't wire)
alter table echo.meeting_item drop constraint meeting_item_meeting_id_fkey;

drop policy meeting_item_read on echo.meeting_item;
drop policy meeting_item_insert on echo.meeting_item;
drop policy meeting_item_update on echo.meeting_item;
drop policy meeting_item_delete on echo.meeting_item;
drop policy meeting_item_agent_insert on echo.meeting_item;

create policy meeting_item_read on echo.meeting_item
  for select using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy meeting_item_insert on echo.meeting_item
  for insert to echo_app with check (
    org_id = echo.actor_org_id() and echo.actor_is_active()
    and created_by = echo.actor_id()
    and source = 'user'
  );

create policy meeting_item_update on echo.meeting_item
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id());

create policy meeting_item_delete on echo.meeting_item
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

-- THE WALL, unchanged in substance: insert only, source pinned to 'ai'.
create policy meeting_item_agent_insert on echo.meeting_item
  for insert to echo_agent with check (
    org_id = echo.actor_org_id() and echo.actor_is_active()
    and created_by = echo.actor_id()
    and source = 'ai'
  );

do $$
declare
  v_org   uuid;
  v_org2  uuid;
  v_p     uuid := gen_random_uuid();
  v_meet  uuid;
begin
  insert into echo.org (name, locale) values ('probe-0161', 'fa') returning id into v_org;
  insert into echo.org (name, locale) values ('probe-0161-b', 'fa') returning id into v_org2;
  insert into auth.users (id, email) values (v_p, 'probe-0161@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_p, v_org, 'probe-0161@example.test', 'probe', 'owner', 'active');
  insert into echo.meeting (org_id, title, scheduled_at, created_by)
  values (v_org, 'probe meeting', now(), v_p) returning id into v_meet;

  -- THE POINT OF THE MIGRATION: an item claiming another organisation while
  -- pointing at this meeting is now unrepresentable — refused by the
  -- CONSTRAINT, which cannot be intersected away by anybody's policies.
  begin
    insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values (v_meet, v_org2, 'risk', 'cross-org', 'user', v_p);
    raise exception 'CHECK FAILED: an item attached to another organisation''s meeting';
  exception when foreign_key_violation then
    null;
  end;

  -- and the ordinary insert still lands (the permitted twin: without it, a
  -- malformed statement would satisfy the refusal above and prove nothing)
  insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
  values (v_meet, v_org, 'risk', 'ok', 'user', v_p);
  if not exists (select 1 from echo.meeting_item where meeting_id = v_meet) then
    raise exception 'CHECK FAILED: the ordinary insert did not land';
  end if;

  raise notice '0161 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
