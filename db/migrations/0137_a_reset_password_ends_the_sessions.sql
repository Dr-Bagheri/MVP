-- 0137 — ending EVERY session a member holds, for the password reset.
--
-- User directive, 2026-08-29: admins and owners can change another member's
-- password from Management.
--
-- ── why a password reset must end sessions ──────────────────────────────
-- Setting a new password does NOT sign anyone out. Supabase's refresh
-- tokens keep working, so every device that was already signed in stays
-- signed in — which quietly inverts the meaning of the act. An admin
-- resetting a password for a locked-out colleague loses nothing by it; an
-- admin resetting a password BECAUSE an account may be compromised is doing
-- the one thing they think closes the door, and it would not.
--
-- So the reset ends the sessions, and the door for that lives here rather
-- than in the API, because deleting rows in `auth` is not something
-- echo_app can do for itself.
--
-- ── the rank rule is STRICT here, and that is deliberate ────────────────
-- 0135's session doors read `p_user = actor_id() OR actor_outranks(p_user)`.
-- This one drops the self case. Not an oversight:
--
--   * A person changing their OWN password goes through Settings, which
--     requires the CURRENT password. That check is the whole security of
--     the self path — it is what makes a hijacked session unable to lock
--     the real owner out.
--   * An admin door does not ask for a current password, because the point
--     is that the admin does not know it.
--
-- Allowing self here would therefore hand anyone holding a live session a
-- way to change the password without knowing the old one, by routing
-- through the admin door at themselves. The two paths look similar and
-- differ in exactly the check that matters.
--
-- Same reason an admin cannot reset the OWNER's password: `actor_outranks`
-- is strictly-greater rank, so the one account that can undo everything is
-- not resettable by the accounts it governs.

begin;

create or replace function echo.end_all_member_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_user is null then
    return 0;
  end if;

  -- strictly outranked, and NOT self — see the header
  if not echo.actor_outranks(p_user) then
    raise exception 'only someone who outranks this member may end all their sessions'
      using errcode = '42501';
  end if;

  delete from auth.sessions s where s.user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function echo.end_all_member_sessions(uuid) is
  'D8-enumerated (0137): ends EVERY auth session of a member the caller strictly outranks — the second half of an admin password reset, because setting a password does not invalidate refresh tokens on its own. Deliberately has NO self case: the self path (Settings) requires the current password, and routing through this door at yourself would skip exactly that check. Cascade takes the refresh tokens.';

revoke all on function echo.end_all_member_sessions(uuid) from public;
grant execute on function echo.end_all_member_sessions(uuid) to echo_app;

commit;
