-- 0198 — withdrawing an invitation stays with the person who sent it.
--
-- 0197 widened `join_invite_withdraw` to every admin, on the reasoning that a
-- second admin should be able to take a colleague's invitation back. It was
-- inert the moment it landed — and its own test said so: an admin who did not
-- send an invitation cannot SEE it. 0189's read policy admits the invitee and
-- the inviter alone, on purpose and in writing ("the one place in the product
-- where 'an admin can see everything' would turn a courtesy into
-- surveillance"), and a DELETE whose WHERE names the row is gated by the
-- SELECT policies as well. A DELETE policy wider than the SELECT policy is a
-- permission nobody can exercise, which is worse than a narrow one: it reads
-- as a rule and behaves as nothing.
--
-- So the withdraw policy is restored to 0189's shape, and the design stands:
-- an invitation is between the person who sent it and the person who got it.
-- What 0197 got right — one LIVE invitation per person per target, decided
-- rows never blocking a new one — stays. core's withdraw answers 404 when
-- nothing moved, so a refusal no longer wears a 204.

begin;

drop policy join_invite_withdraw on echo.join_invite;
create policy join_invite_withdraw on echo.join_invite
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and invited_by = echo.actor_id());

-- ── self-check: the two policies agree about who may act ──────────────────
do $chk$
declare
  v_read text;
  v_del  text;
begin
  select pg_get_expr(polqual, polrelid) into v_read
    from pg_policy where polname = 'join_invite_read' and polrelid = 'echo.join_invite'::regclass;
  select pg_get_expr(polqual, polrelid) into v_del
    from pg_policy where polname = 'join_invite_withdraw' and polrelid = 'echo.join_invite'::regclass;
  if v_read is null or v_del is null then
    raise exception 'CHECK FAILED: a join_invite policy is missing';
  end if;
  if v_del like '%actor_is_admin%' then
    raise exception 'CHECK FAILED: the withdraw policy is wider than the read policy again';
  end if;
  if v_del not like '%invited_by = echo.actor_id()%' then
    raise exception 'CHECK FAILED: the withdraw policy no longer names the sender';
  end if;
end $chk$;

commit;
