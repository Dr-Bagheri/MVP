-- 0148 — a meeting gets a VIDEO ROOM, and the list gets its delete.
--
-- Walked in the reference again (2026-09-02, user directive: "check again
-- the site go step by step until the end"). Two things came back:
--
-- ── the room ─────────────────────────────────────────────────────────────
-- Their online meeting carries a room of their own making
-- («https://arameet.ir/64g-gxie-v6e») and the live stage's ویدیو tab is
-- that room. This product runs no conferencing — but the org's GOOGLE
-- connector already holds the calendar scope, and a calendar insert with a
-- conference request mints a real Google Meet room. So the meeting stores
-- the room it was given:
--
--   video_url      — the join link, whoever minted it
--   video_provider — google_meet, or `custom` for a link a person pasted
--                    (Zoom, Teams, a room the company already runs)
--
-- A link is not a secret, but it is a KEY: anyone holding it can walk in.
-- It therefore lives under the same org wall as the rest of the row, and
-- the api never returns it to a gateway key.
--
-- ── the way out ──────────────────────────────────────────────────────────
-- Their row menu offers آرشیو جلسه AND حذف جلسه, and the user asked for
-- both. 0145 gave app roles no DELETE on echo.meeting, so ours could only
-- archive. That closed list exists to protect RECORDS, and a meeting is
-- not one: it is a PLAN a person made. The call it produced is a separate
-- row with its own soft-delete ladder and its own purge window, and
-- deleting the plan cannot touch it (call_id is this row's reference, not
-- the call's). Nothing hangs off a meeting. So DELETE joins the argued
-- list, with that reasoning, and the guard's exact array grows by one.

begin;

alter table echo.meeting
  add column video_url      text check (video_url is null or length(video_url) between 8 and 2000),
  add column video_provider text
    check (video_provider is null or video_provider in ('google_meet', 'custom'));

comment on column echo.meeting.video_url is
  '0148: the meeting''s video room — minted through the org''s Google connector, or a link a person pasted. A link is a key: it stays behind the org wall and never reaches a gateway key.';
comment on column echo.meeting.video_provider is
  '0148: google_meet | custom. NULL means no room — an online meeting without one is a normal state, not a broken row.';

-- the argued delete (see the header): a meeting is a plan, and the record
-- it produced is a different row that this delete cannot reach
grant delete on echo.meeting to echo_app;

create policy meeting_delete on echo.meeting
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

do $check$
begin
  -- the closed list is exactly the six argued tables, no more
  if (select coalesce(array_agg(distinct table_name::text order by table_name::text), '{}')
        from information_schema.role_table_grants
       where grantee = 'echo_app' and privilege_type = 'DELETE' and table_schema = 'echo')
     <> array['call_note', 'meeting', 'task_assignee', 'task_checklist_item',
              'task_label', 'task_label_link'] then
    raise exception 'the DELETE closed list changed beyond 0148''s argued addition';
  end if;

  -- the call a meeting points at is NOT reachable from this delete
  if exists (
    select 1 from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where con.contype = 'f' and n.nspname = 'echo'
       and ref.relname = 'meeting' and con.confdeltype = 'c'
  ) then
    raise exception 'something cascades from echo.meeting — deleting a plan must never take a record with it';
  end if;
end
$check$;

commit;
