-- 0217 — a meeting's aftermath reaches the people it concerns.
--
-- User directive, 2026-09-10: "make it more AI agentic with the same things
-- we have." The pieces existed and did not meet. The summarizer's third pass
-- (0209/0211) writes a meeting's decisions and commitments as `meeting_item`
-- rows — with the OWNER resolved to an account when the roster names one —
-- and the bell (0074's `agent_card`) is the channel through which the
-- platform tells a person something without being asked. Nothing joined
-- them: a commitment landed in a ledger nobody was told about, and the
-- summary's readiness reached exactly one person, the call's owner, through
-- the post-call brief. Everybody else in the room found out by going to look,
-- which is the opposite of an assistant.
--
-- ── TWO CARDS, ONE DOOR ──────────────────────────────────────────────────
--
--   meeting_ready       to every ACCOUNT on the roster but the host, once per
--                       meeting: «the summary of X is ready». The host already
--                       gets the brief (0112's switch is theirs to turn).
--   meeting_commitment  to the owner of each `action` item the extraction
--                       landed, the item's own sentence as the card's body,
--                       once per (meeting, owner, sentence). The host too — a
--                       promise is a promise whoever hosts.
--
-- ── WHY A DOOR (0167's argument, unchanged) ──────────────────────────────
--
-- `agent_card_own` lets a person write cards for THEMSELVES and nobody else,
-- and that stays exactly so — the standing test asserts the direct insert is
-- still refused. The worker runs as the CALL'S OWNER (M35, the job-identity
-- precedent), so writing a card into a colleague's inbox needs a definer door
-- with its own checks, and the checks are the design: the caller must be the
-- meeting's HOST (0202 — the recording is theirs, so the extraction is
-- theirs); the recipients are read from the meeting's own roster and items,
-- never taken from the caller; only active members of the same organisation
-- receive anything. The sender is nobody — `from_user_id` stays NULL, which
-- the bell renders as "the platform made this" — because a card the platform
-- composed must not wear a colleague's name (0164: an agent posting as a
-- person is unrepresentable, and a door that could do it would make it so).
--
-- ── WHAT THE CARD POINTS AT ──────────────────────────────────────────────
--
-- `meeting_id` is a new column, a composite FK that NAMES ITS COLUMN in the
-- set-null clause (0188/0195: a bare `set null` over a key holding NOT NULL
-- org_id can only ever raise, and reads as intended). A card outlives its
-- meeting as a tombstoned pointer, the way 0074 let a card outlive its
-- conversation. No per-item column: the item's sentence is on the card, and
-- a card that opened a deleted item would be a dead link wearing a
-- notification.
--
-- ── IDEMPOTENT BY LOOKUP, NOT BY CONSTRAINT ──────────────────────────────
--
-- Regenerating a summary re-runs the extraction (which refuses duplicate
-- sentences, 0211) and calls this door again. A second «ready» card for the
-- same person, or a second copy of the same commitment, is what the
-- `not exists` clauses prevent. A unique index would have said the same thing
-- louder and refused the WHOLE call for one repeated row.

begin;

alter table echo.agent_card add column meeting_id uuid;

alter table echo.agent_card
  add constraint agent_card_meeting_same_org
  foreign key (meeting_id, org_id) references echo.meeting (id, org_id)
  on delete set null (meeting_id);

create index agent_card_meeting_idx on echo.agent_card (meeting_id)
  where meeting_id is not null;

comment on column echo.agent_card.meeting_id is
  '0217: the meeting a meeting_ready / meeting_commitment card is about — the bell opens it. Nulled, never deleted, when the meeting goes (the set null names its column).';

-- the kinds, widened (0116/0167's shape: drop by name, add the whole list)
alter table echo.agent_card
  drop constraint agent_card_kind_check,
  add constraint agent_card_kind_check
  check (kind in ('post_call_brief', 'weekly_digest', 'workflow_result', 'mail_draft',
                  'meeting_prep', 'member_message', 'meeting_ready', 'meeting_commitment'));

-- ── the door ───────────────────────────────────────────────────────────────
create or replace function echo.deliver_meeting_cards(p_meeting uuid, p_items uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := echo.actor_id();
  v_org   uuid := echo.actor_org_id();
  v_title text;
  v_host  uuid;
  v_ready integer := 0;
  v_owed  integer := 0;
begin
  if v_actor is null or v_org is null then
    raise exception 'no actor' using errcode = '42501';
  end if;
  if not echo.actor_is_active() then
    raise exception 'caller is not an active member' using errcode = '42501';
  end if;

  -- The meeting is verified against the table, never taken on the caller's
  -- word: this runs as its owner, so the RLS that would normally answer
  -- "no such meeting" is not in the way and the check has to be here.
  select m.title, m.created_by into v_title, v_host
    from echo.meeting m
   where m.id = p_meeting and m.org_id = v_org;
  if v_host is null then
    -- one answer for another organisation's meeting and for no meeting at
    -- all: distinguishing them would make this an oracle for what exists
    raise exception 'no such meeting' using errcode = '22023';
  end if;
  if v_host <> v_actor then
    raise exception 'only the meeting''s host delivers its cards' using errcode = '42501';
  end if;

  -- «the summary is ready»: the roster's accounts, the host excepted, once
  insert into echo.agent_card (org_id, owner_id, kind, title, meeting_id)
  select v_org, a.user_id, 'meeting_ready', v_title, p_meeting
    from echo.meeting_attendee a
    join echo.app_user u on u.id = a.user_id and u.org_id = v_org and u.status = 'active'
   where a.meeting_id = p_meeting
     and a.user_id <> v_actor
     and not exists (
       select 1 from echo.agent_card c
        where c.meeting_id = p_meeting and c.owner_id = a.user_id and c.kind = 'meeting_ready');
  get diagnostics v_ready = row_count;

  -- «you committed to this»: the owner of each named action, their own
  -- sentence on the card, once per sentence
  insert into echo.agent_card (org_id, owner_id, kind, title, body, meeting_id)
  select distinct v_org, i.owner_id, 'meeting_commitment', v_title, i.body, p_meeting
    from echo.meeting_item i
    join echo.app_user u on u.id = i.owner_id and u.org_id = v_org and u.status = 'active'
   where i.meeting_id = p_meeting
     and i.id = any (p_items)
     and i.kind = 'action'
     and not exists (
       select 1 from echo.agent_card c
        where c.meeting_id = p_meeting and c.owner_id = i.owner_id
          and c.kind = 'meeting_commitment' and c.body = i.body);
  get diagnostics v_owed = row_count;

  return v_ready + v_owed;
end $fn$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default (0205's
-- lesson): a null ACL is not "no grants", it is everybody.
revoke all on function echo.deliver_meeting_cards(uuid, uuid[]) from public;
grant execute on function echo.deliver_meeting_cards(uuid, uuid[]) to echo_app;

comment on function echo.deliver_meeting_cards(uuid, uuid[]) is
  'D8 door (0217): the meeting''s HOST — echo.actor_id(), never an argument — delivers the aftermath as bell cards: meeting_ready to every other account on the roster, meeting_commitment to the owner of each landed action item. Recipients come from the meeting''s own rows; idempotent by lookup; echo_app only.';

-- ── self-checks: the STRUCTURE. The behavioural matrix is db/test/124, which
-- seeds its own meeting and runs every time; a check here would depend on
-- whatever this database happens to hold.
do $chk$
declare
  v_def  text;
  v_cols smallint[];
  v_att  smallint;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'echo.agent_card'::regclass and conname = 'agent_card_kind_check';
  if v_def is null or v_def not like '%meeting_ready%' or v_def not like '%meeting_commitment%' then
    raise exception 'CHECK FAILED: the kind check did not learn the two cards';
  end if;

  -- the set-null names its column (0195's class), so a deleted meeting can
  -- never take org_id with it and raise instead
  select confdelsetcols into v_cols from pg_constraint where conname = 'agent_card_meeting_same_org';
  select attnum into v_att from pg_attribute
   where attrelid = 'echo.agent_card'::regclass and attname = 'meeting_id' and not attisdropped;
  if v_cols is null or v_cols <> array[v_att]::smallint[] then
    raise exception 'CHECK FAILED: agent_card_meeting_same_org does not set null on meeting_id alone';
  end if;

  -- the door is echo_app's alone: not PUBLIC (grantee 0), not the agent, not the purge
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'echo' and p.proname = 'deliver_meeting_cards'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or r.rolname in ('echo_agent', 'echo_purge'))
  ) then
    raise exception 'CHECK FAILED: deliver_meeting_cards is executable beyond echo_app';
  end if;
  if not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     join pg_roles r on r.oid = a.grantee
    where n.nspname = 'echo' and p.proname = 'deliver_meeting_cards'
      and a.privilege_type = 'EXECUTE' and r.rolname = 'echo_app'
  ) then
    raise exception 'CHECK FAILED: echo_app cannot execute deliver_meeting_cards';
  end if;

  raise notice '0217: structure checked — kinds, the named set-null, the grant; the matrix is db/test/124';
end $chk$;

commit;
