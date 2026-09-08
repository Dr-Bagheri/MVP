-- 0216 — a colleague can be messaged on Telegram, once they have started it.
--
-- User report, 2026-09-08 (with the screenshot): the assistant was asked to
-- send a Telegram message to a colleague, given their @username and their
-- phone number, and it failed. It could not have succeeded.
--
-- ── TELEGRAM'S OWN RULE IS THE WHOLE DESIGN ──────────────────────────────
--
-- A bot cannot open a conversation with a person. The person must message
-- the bot first; only then does the bot have a chat to answer in, addressed
-- by a NUMERIC chat id. A @username reaches a public channel or group — never
-- a private individual — and a phone number reaches nothing at all. So the
-- product could ask for a chat id nobody has, or it could know.
--
-- It already knows. 0212's link is exactly that gesture: a colleague opens
-- the organisation's bot, sends the code they minted inside the platform, and
-- `echo.telegram_identity` records who they are and the chat the bot answers
-- them in. **The consent Telegram requires and the consent our link records
-- are the same act** — nobody is reachable here who did not personally start
-- a conversation with this bot.
--
-- ── WHY A DOOR AND NOT A POLICY ──────────────────────────────────────────
--
-- 0212 scoped `telegram_identity` to its owner (`user_id = echo.actor_id()`),
-- deliberately: an admin may not enumerate who has linked, and a colleague's
-- Telegram id is not org-readable data. That stays true. This door answers
-- ONE question for ONE named person — "where does the bot answer them" — and
-- the answer never leaves the server: the api resolves it inside the send and
-- returns a message id, so no caller, no model and no browser ever holds the
-- number. A `select` policy widened for the same purpose would have handed it
-- to every reader of the table forever.
--
-- ONE COLUMN, one argument (0158's rule): a security surface that is a SHAPE
-- cannot be widened by somebody forgetting a filter — only by a migration
-- that changes this signature, which is a thing a reviewer sees.
--
-- NULL is the answer for every refusal — not linked, not in this org, not
-- active, no such person. The api turns that into one sentence naming the
-- colleague and what to do; distinguishing them here would make this door an
-- oracle for "does this person use Telegram", which is precisely the fact
-- 0212's owner-scoped policy exists to keep.

begin;

create function echo.telegram_chat_for(p_user uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select i.chat_id
    from echo.telegram_identity i
    join echo.app_user u on u.id = i.user_id
   where i.user_id = p_user
     and i.org_id = echo.actor_org_id()
     and u.org_id = echo.actor_org_id()
     and u.status = 'active'
     and echo.actor_is_active()
$$;

comment on function echo.telegram_chat_for(uuid) is
  '0216 (D8-enumerated): where the org bot answers ONE named active colleague, for sending only — the api resolves it inside the send and never returns it. NULL for every refusal, so this cannot answer "does this person use Telegram".';

-- 0205's lesson, written the first time here: a new function is EXECUTABLE BY
-- PUBLIC by default, so a missing revoke is not "no grants", it is everybody.
revoke all on function echo.telegram_chat_for(uuid) from public;
grant execute on function echo.telegram_chat_for(uuid) to echo_app;

-- ── self-checks ───────────────────────────────────────────────────────────
do $check$
declare
  v_out int;
  v_in  int;
begin
  -- the SHAPE: one argument in, a scalar out. A version returning the row
  -- (or `setof`) would hand out `user_id`, `created_at` and the link's own
  -- history beside the number.
  select count(*) into v_out
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(coalesce(p.proallargtypes, '{}'::oid[]), coalesce(p.proargmodes, '{}'::"char"[]))
      as a(t, m) on true
   where n.nspname = 'echo' and p.proname = 'telegram_chat_for' and a.m = 't';
  if v_out <> 0 then
    raise exception '0216: telegram_chat_for returns % out-columns — it must be a scalar', v_out;
  end if;

  select p.pronargs into v_in
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'telegram_chat_for';
  if v_in <> 1 then
    raise exception '0216: telegram_chat_for takes % arguments, not 1', v_in;
  end if;

  -- WHO HOLDS IT. echo_agent must not: an agent that can resolve a
  -- colleague's Telegram chat has a reach the person never granted it, and
  -- the send it is for runs on the app role through a consent card.
  if has_function_privilege('echo_agent', 'echo.telegram_chat_for(uuid)', 'EXECUTE') then
    raise exception '0216: echo_agent can execute the telegram chat door';
  end if;
  if has_function_privilege('public', 'echo.telegram_chat_for(uuid)', 'EXECUTE') then
    raise exception '0216: the door is executable by PUBLIC — the revoke did not take';
  end if;
  if not has_function_privilege('echo_app', 'echo.telegram_chat_for(uuid)', 'EXECUTE') then
    raise exception '0216: echo_app cannot execute it — nobody could send anything';
  end if;

  -- and the table it reads stays shut: this migration must not have widened
  -- the owner-scoped read 0212 wrote (the policy count is a fact about the
  -- wall, so it is asserted as the wall's own names, not as a census).
  if exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'telegram_identity'
       and policyname not in ('telegram_identity_read_own', 'telegram_identity_delete_own')
  ) then
    raise exception '0216: telegram_identity gained a policy — the link table is owner-scoped by design';
  end if;
end $check$;

commit;
