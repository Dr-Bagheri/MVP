-- 0113 — the sessions door serves an ADDRESS, not a subnet.
--
-- 0112's `s.ip::text` came back "203.0.113.7/32": inet's text form carries
-- the netmask, and a security screen showing every device as a /32 subnet
-- reads as a bug wearing precision. host() is the address alone. Caught by
-- 96_personal_settings' first run — the assertion compared the address it
-- seeded to the subnet the door returned.

begin;

create or replace function echo.my_auth_sessions()
returns table (handle text, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, ip text)
language sql
security definer
set search_path = ''
stable
as $$
  select left(s.id::text, 8), s.created_at, s.refreshed_at,
         s.user_agent, host(s.ip)
    from auth.sessions s
   where s.user_id = echo.actor_id()
   order by coalesce(s.refreshed_at, s.created_at) desc
   limit 20
$$;

commit;
