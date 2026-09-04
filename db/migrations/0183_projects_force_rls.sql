-- 0183 — the project tables force RLS
--
-- db/0181 enabled row level security and stopped there, and the suite's next
-- check caught it: every table in this schema must have RLS **enabled AND
-- FORCED**.
--
-- The difference is the whole point of the rule. `enable` makes policies apply
-- to ordinary roles; the table's OWNER is exempt until `force`. Our migrations
-- run as the owner, and so does anything else that ever connects with that
-- role — so a table that is merely enabled has a wall with a door in it that
-- nobody can see from the application side. Two lines, and without them the
-- policies argued in 0181 are advisory for exactly the connection most likely
-- to be used by somebody in a hurry.

begin;

alter table echo.project        force row level security;
alter table echo.project_member force row level security;

do $chk$
declare
  v text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relkind = 'r'
     and c.relname in ('project', 'project_member')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if v is not null then
    raise exception 'CHECK FAILED: RLS is not enabled AND forced on: %', v;
  end if;
end $chk$;

commit;
