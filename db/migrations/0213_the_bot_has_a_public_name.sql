-- 0213 — the organisation's bot has a name, and a colleague may read it.
--
-- 0212 landed with a hole this file closes, and the hole is the shape rule
-- 13½ describes: a producer with no consumer, seen from the other side.
--
-- The link flow says "send this code to the bot". A colleague therefore has
-- to know WHICH bot — and `connector_connection` is owner-scoped by 0065's
-- policy (`owner_id = echo.actor_id()`), so everybody except the person who
-- connected it reads nothing. The screen's fallback sentence, «send it to
-- your organisation's Telegram bot», is honest and useless: there is no way
-- to act on it.
--
-- ── WHY THIS IS SAFE TO WIDEN, and only this ─────────────────────────────
--
-- A bot's @username is PUBLIC BY CONSTRUCTION. It is how anybody reaches a
-- bot, it appears in every invite link, and 0212's whole security argument
-- starts from the fact that strangers can already find it — which is why the
-- link exists at all. Telling a member of the organisation the handle of the
-- bot they are being asked to message reveals nothing that was not already
-- discoverable, and withholding it only stops the person who has a right to
-- use it.
--
-- The token is a different fact and stays exactly where it was: in
-- `connector_secret`, encrypted, owner-scoped, unreadable through this door
-- or any other. The door RETURNS ONE COLUMN, so — 0158's rule again — this
-- surface cannot be widened by somebody forgetting a filter; it can only be
-- widened by a migration that changes its signature, which is a thing a
-- reviewer sees.

begin;

create function echo.org_telegram_bot()
returns table (bot_username text)
language sql
security definer
set search_path = ''
stable
as $$
  select nullif(ltrim(c.account_label, '@'), '')
    from echo.connector_connection c
   where c.org_id = echo.actor_org_id()
     and c.provider = 'telegram'
     and c.status = 'connected'
     and echo.actor_is_active()
   limit 1
$$;

comment on function echo.org_telegram_bot() is
  '0213 (D8-enumerated): the org bot''s public @handle, for the colleague being asked to message it. One column by design — the token is in connector_secret and no door reaches it. Requires an ACTIVE actor: a pending or disabled person has no bot to message.';

revoke all on function echo.org_telegram_bot() from public;
grant execute on function echo.org_telegram_bot() to echo_app;

-- ── self-checks ───────────────────────────────────────────────────────────
do $check$
declare
  v_cols int;
begin
  -- ONE COLUMN. The security surface is a shape; asserting it costs a line
  -- and catches the day somebody adds `token` "just for the settings screen".
  select count(*) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proallargtypes, p.proargmodes) as a(t, m) on true
   where n.nspname = 'echo' and p.proname = 'org_telegram_bot' and a.m = 't';
  if v_cols <> 1 then
    raise exception '0213: org_telegram_bot returns % columns, not 1 — the door has been widened', v_cols;
  end if;

  -- and the discriminating half: the agent role must NOT hold it. An agent
  -- that can enumerate an organisation's connected accounts is reconnaissance
  -- wearing a convenience.
  if has_function_privilege('echo_agent', 'echo.org_telegram_bot()', 'EXECUTE') then
    raise exception '0213: echo_agent can execute the bot-name door';
  end if;
  if not has_function_privilege('echo_app', 'echo.org_telegram_bot()', 'EXECUTE') then
    raise exception '0213: echo_app cannot — nobody could read the handle at all';
  end if;
end $check$;

commit;
