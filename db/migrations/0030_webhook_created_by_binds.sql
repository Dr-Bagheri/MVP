-- Echo — 0030: registering a webhook binds it to the registrar.
--
-- Under M17 the dispatcher runs as webhook.created_by, which turned that
-- column from a record of who registered it into an assignment of outbound
-- authority. Nothing required it to be the acting admin: the policy checked
-- that the ACTOR was an admin, not that created_by was the actor. So admin A
-- could register a webhook that dispatches as admin B, giving B's authority to
-- an endpoint B has never seen — authority assignment by accident.
--
-- The contrast with api_key.actor_id is the whole reasoning, and it is not an
-- inconsistency: acts-as is that feature's explicit design, chosen at mint and
-- surfaced as "runs as X". created_by is a FACT — who registered this — and a
-- fact must not be supplyable. If webhooks ever need acts-as, it arrives as an
-- explicit actor_id column chosen at creation, the way api_key did, and never
-- as an accident of created_by.
--
-- Ruled: only CREATION binds identity. Editing and disabling stay any-admin,
-- so a departed creator does not strand a webhook — recovery is another admin
-- re-registering under their own name, which is the revoke-and-reissue
-- posture in outbound form.

drop policy webhook_admin on echo.webhook;

create policy webhook_read on echo.webhook for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());

create policy webhook_register on echo.webhook for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_admin()
    and created_by = echo.actor_id()
  );

create policy webhook_manage on echo.webhook for update to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

-- The other half of the same rule. Binding creation is pointless if an edit
-- can reassign it afterwards, and `with check` cannot see the old row.
create function echo.tg_webhook_created_by_immutable() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'a webhook''s registrar is a fact, not a setting; re-register it instead'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger webhook_created_by_immutable
  before update on echo.webhook
  for each row execute function echo.tg_webhook_created_by_immutable();
