-- 0206 — the meeting's STAGE is shared, and it is the host's to drive (user
-- directive, 2026-09-07: "in the meeting when it starts only the host can play
-- with the whiteboard and all invited to the meeting must be able to see it as
-- well, same for the presentation").
--
-- ── what was there ──────────────────────────────────────────────────────
--
-- The whiteboard was `localStorage` per browser, and its own header said so:
-- "what it deliberately is NOT in v1: collaborative or server-persisted…a
-- colleague's screen shows their own". That was an honest v1 and it is now the
-- wrong product: a board nobody else can see is a board the host is drawing
-- for themselves in a meeting, and every colleague looking at the same tab
-- title saw an empty canvas. The presentation was worse in the same direction
-- — a PDF read into an object URL inside ONE browser.
--
-- ── the shape, and why it is columns rather than a table ────────────────
--
-- A board has exactly one meeting, no independent lifetime, and no rows of its
-- own to page through. As a table it would need its own policies, its own
-- grants, and an entry in the purge's enumerated deletes (0145's coverage
-- rule) — three places to get wrong for a fact that is one value per meeting.
-- As columns it inherits meeting_read, meeting_update, the org wall and the
-- purge, all of which are already asserted, and `meetingRows` names its
-- columns one by one so the board cannot ride a list read by accident.
--
-- `board_version` is what a viewer polls on: a counter is a few bytes, and a
-- board mid-meeting is not. It is bumped by the trigger rather than by the
-- caller — a client that supplied its own version could hold one still while
-- the strokes moved, and every reader would stop refreshing.
--
-- ── the wall ────────────────────────────────────────────────────────────
--
-- meeting_update admits every active member (0145), which is right for the
-- PLAN — a colleague may reschedule a meeting they did not create. It is wrong
-- for the stage, so the stage gets 0202's shape: a trigger, refusing a change
-- to these three columns by anyone who is not `created_by`, and SILENT when no
-- actor is set, because that is the purge and a purge that raises is a purge
-- that does not run.

begin;

alter table echo.meeting
  add column board jsonb not null default '[]'::jsonb
    constraint meeting_board_is_array check (jsonb_typeof(board) = 'array'),
  add column board_version integer not null default 0,
  /* the document the host is SHOWING, out of the meeting's own attachments
     (0159). Column-specific `set null` by name — a bare `set null` on a
     composite key nulls every column in it, which cost 0188 a migration and
     0191 another; this key has one column and the habit is still worth
     keeping visible. */
  add column presenting_attachment_id uuid
    references echo.meeting_attachment(id) on delete set null;

comment on column echo.meeting.board is
  '0206: the whiteboard, shared. Shapes in WORLD coordinates, exactly as the canvas stores them; the ink is a ROLE resolved against the reader''s own theme, so one board reads in both.';
comment on column echo.meeting.board_version is
  '0206: bumped by the trigger on every board write. What a viewer polls, so that a board mid-meeting is not sent to everybody every three seconds.';
comment on column echo.meeting.presenting_attachment_id is
  '0206: which of the meeting''s attachments the host is showing. Null is the ordinary state — nobody is presenting.';

-- ── the stage is the host's ─────────────────────────────────────────────
create function echo.tg_meeting_stage_is_the_hosts() returns trigger
  language plpgsql
  set search_path = ''
as $fn$
begin
  if (new.board is distinct from old.board
      or new.presenting_attachment_id is distinct from old.presenting_attachment_id)
     and echo.actor_id() is not null
     and echo.actor_id() is distinct from old.created_by then
    raise exception 'only the meeting''s host may drive its stage'
      using errcode = 'insufficient_privilege';
  end if;

  /* THE VERSION IS THE DATABASE'S, not the caller's. A client that could
     supply it could hold it still while the strokes moved, and every viewer
     polling on it would stop refreshing while looking at a live board. */
  if new.board is distinct from old.board then
    new.board_version := old.board_version + 1;
  else
    new.board_version := old.board_version;
  end if;

  return new;
end
$fn$;

comment on function echo.tg_meeting_stage_is_the_hosts() is
  '0206: meeting.board and presenting_attachment_id move only under the host''s own identity, and board_version is stamped here rather than sent. Silent when no actor is set — the purge must never raise.';

create trigger tg_meeting_stage_is_the_hosts
  before update on echo.meeting
  for each row execute function echo.tg_meeting_stage_is_the_hosts();

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_org     uuid := '0a000000-0000-4000-8000-0000000206aa';
  v_host    uuid := '01000000-0000-4000-8000-0000000206bb';
  v_other   uuid := '02000000-0000-4000-8000-0000000206cc';
  v_meeting uuid := 'b0000000-0000-4000-8000-0000000206dd';
  v_ver     integer;
  v_refused boolean := false;
begin
  -- 1) the columns exist with the shapes the wire will read
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'echo' and table_name = 'meeting'
                    and column_name = 'board' and data_type = 'jsonb') then
    raise exception '0206: meeting.board is missing or is not jsonb';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'meeting' and t.tgname = 'tg_meeting_stage_is_the_hosts') then
    raise exception '0206: the stage trigger is not attached';
  end if;

  -- 2) BEHAVIOUR, on rows this check makes itself and then UNMAKES — "did
  --    not run" is not an outcome anybody can read later, and borrowing
  --    whatever meetings production happens to hold is rule 9's own trap.
  --
  --    The seeds are undone by RAISING out of the block rather than by
  --    deleting them: the first draft deleted its rows in order and the
  --    migration refused, because app_user does not simply go (it tombstones,
  --    and the org's FK is the wall that says so). A subtransaction that
  --    unwinds cannot leave a half-swept fixture behind, whichever assertion
  --    fails.
  begin
    insert into echo.org (id, name) values (v_org, '0206 self-check');
    insert into auth.users (id, email) values
      (v_host, '0206-host@example.invalid'), (v_other, '0206-other@example.invalid');
    insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at) values
      (v_host,  v_org, '0206-host@example.invalid',  'host',  'owner',  'active', now()),
      (v_other, v_org, '0206-other@example.invalid', 'other', 'member', 'active', now());
    insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
      values (v_meeting, v_org, '0206', now(), 'online', v_host);

    -- the HOST draws, and the version moves by itself
    perform set_config('echo.actor_id', v_host::text, true);
    update echo.meeting set board = '[{"tool":"pen"}]'::jsonb where id = v_meeting;
    select board_version into v_ver from echo.meeting where id = v_meeting;
    if v_ver <> 1 then
      raise exception '0206: the version did not move on a board write (%)', v_ver;
    end if;

    -- a write that does NOT touch the board leaves the version alone, or every
    -- reschedule would look like a stroke to every viewer polling on it
    update echo.meeting set title = '0206 renamed' where id = v_meeting;
    select board_version into v_ver from echo.meeting where id = v_meeting;
    if v_ver <> 1 then
      raise exception '0206: the version moved on a write that was not the board (%)', v_ver;
    end if;

    -- THE DISCRIMINATING HALF: a colleague is refused. Without it the checks
    -- above pass against a trigger that lets everybody draw.
    perform set_config('echo.actor_id', v_other::text, true);
    begin
      update echo.meeting set board = '[{"tool":"pen"},{"tool":"rect"}]'::jsonb where id = v_meeting;
    exception when insufficient_privilege then
      v_refused := true;
    end;
    if not v_refused then
      raise exception '0206: a colleague drew on the host''s board';
    end if;

    -- and the SILENT case the purge needs: no actor, no refusal
    perform set_config('echo.actor_id', '', true);
    update echo.meeting set board = '[]'::jsonb where id = v_meeting;

    -- everything above is undone by this
    raise exception 'SELFCHECK_ROLLBACK_0206';
  exception
    when raise_exception then
      if sqlerrm <> 'SELFCHECK_ROLLBACK_0206' then raise; end if;
  end;
end
$check$;

commit;
