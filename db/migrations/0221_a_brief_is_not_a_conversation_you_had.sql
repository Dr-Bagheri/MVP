-- 0221 — a brief the agent wrote you is not a conversation you had.
--
-- Found rehearsing the demo, 2026-09-09: four recorded meetings, four
-- summaries, and four new rows in the assistant's conversation sidebar —
-- «خلاصهٔ آمادهٔ «Weekly meeting with NAI»», one per processed call. A
-- session appeared for every summary that landed, which is not the intended
-- behaviour.
--
-- The cause is `writeCard` in core/src/worker/signal-step.ts, and the same
-- shape in worker/meeting-prep.ts, worker/mail-poll.ts and workflow-step's
-- `notify`: every one of them calls `sessions.resolveForAsk(identity, null,
-- title)` to give its text somewhere to live, and `resolveForAsk` with a
-- null session id is exactly the call the ASK route makes when a person
-- starts a new conversation. One function, two meanings, and the sidebar
-- reads the second one.
--
-- ── THE DISTINCTION THIS COLUMN DRAWS ─────────────────────────────────────
--
-- 0016 already separated `agent_run` (the audit record of one execution,
-- invariant 5, readable by an admin) from `agent_session` (a person's
-- private conversation). That separation is right and this changes none of
-- it. What was never separated is a second pair inside `agent_session`:
--
--   * the CONTENT'S HOME — somewhere an agent-initiated body can be stored,
--     rendered and asked about in place. 0074's card carries `session_id`
--     precisely so a brief opens "as a real conversation" (M35).
--   * the PERSON'S HISTORY — the list of conversations that person had.
--
-- A background job that ran on their behalf produced the first and is not
-- the second. So the row stays, keeps its messages, keeps its card, stays
-- openable from the bell — and stops claiming to be something the person
-- started.
--
-- ── WHY NOT THE OTHER THREE FIXES ─────────────────────────────────────────
--
-- *Stop creating the session.* Refused: 0074's card is titles and refs only
-- and deliberately holds no body (`agent_card.body` exists for
-- `member_message`, whose content has nowhere else to be). Killing the
-- session would either put call-derived prose into the card table or throw
-- the brief away, and it would break "you can ask about it right here",
-- which is the whole of M35's value.
--
-- *Delete the row after delivery.* Refused for the same reason and worse:
-- the card would become a tombstoned pointer (0074's SET NULL) and the
-- person would open a bell item onto nothing.
--
-- *Leave it and move the notification.* Refused because the notification is
-- ALREADY where it belongs — `/v1/cards`, the dock. The duplicate is the
-- sidebar row, not the card.
--
-- Nothing here touches `agent_run`: these runs record their spend and steps
-- exactly as before, and the admin's run feed is unchanged. Losing an audit
-- trail to tidy a sidebar would be a worse bug than the one being fixed.
--
-- ── WHY THE RULE IS A FUNCTION AND NOT A PREDICATE IN THE LIST QUERY ──────
--
-- `origin = 'agent'` is not on its own the right filter. The brief ends with
-- «می‌توانید همین‌جا درباره‌اش بپرسید» — ask about it right here. When
-- somebody does, that thread IS a conversation they had, and burying it
-- forever once the card scrolls away would be a fresh way to lose their
-- words. So the rule has two arms: they started it, or they have spoken in
-- it.
--
-- Two arms is exactly how db/0048 got burned (`run_is_truncated`: my
-- `= 'error'` and the stamp's `<> 'ok'` were one rule spelled twice, and
-- they disagreed). So the rule is ONE function that core/ calls and that
-- this migration's own self-check calls — a check that re-spells the
-- predicate proves only that the check agrees with itself.
--
-- Not SECURITY DEFINER, deliberately: it runs as the caller so the EXISTS
-- sits under `agent_message_own`. A session whose messages you cannot read
-- is not yours, and this must never become a door that says otherwise.

begin;

alter table echo.agent_session
  add column origin text not null default 'user'
    -- a text CHECK rather than a new enum type, matching `agent_card.kind`:
    -- 0164 already had to protect an enum from a value added under it, and
    -- two values that will not grow do not earn a type.
    constraint agent_session_origin_known check (origin in ('user', 'agent'));

comment on column echo.agent_session.origin is
  'Who opened this conversation (0221). ''user'' = a person asked something; '
  '''agent'' = a background job (post-call brief, weekly digest, meeting prep, '
  'mail draft, workflow notify) needed somewhere to put its text and a card '
  'to point at. An ''agent'' row is reachable from the dock and from its card, '
  'and joins the person''s history the moment they speak in it — see '
  'echo.session_belongs_in_history.';

-- ── the one spelling of the rule ──────────────────────────────────────────
create function echo.session_belongs_in_history(p_origin text, p_session uuid)
  returns boolean
  language sql
  stable
  set search_path = ''
as $$
  select p_origin is distinct from 'agent'
      or exists (
           select 1 from echo.agent_message m
            where m.session_id = p_session and m.role = 'user'
         );
$$;

comment on function echo.session_belongs_in_history(text, uuid) is
  'Is this session part of the person''s conversation LIST? They started it, '
  'or they have spoken in it. Called by core/''s sessions.list() and by '
  '0221''s self-check — one predicate, never two spellings (the 0048 lesson).';

-- The revoke is not decoration: Postgres grants EXECUTE on a new function to
-- PUBLIC by default, so a grant list with no revoke beside it READS as the
-- whole story and is not one (0204's mistake, and 0205 exists to correct it).
-- Nothing is leaked here — this is not a definer door and the EXISTS runs as
-- the caller, under `agent_message_own` — but the grant list should say what
-- it means the first time.
revoke all on function echo.session_belongs_in_history(text, uuid) from public;
grant execute on function echo.session_belongs_in_history(text, uuid)
  to echo_app, echo_agent;

-- ── the rows that already exist ───────────────────────────────────────────
-- Every background writer inserts an `agent_card` pointing at the session it
-- made, so the card table is the complete record of which existing sessions
-- were agent-initiated. `mail_draft` and `meeting_prep` are named too rather
-- than trusted to the card: they are the rows a person would notice missing,
-- and a card insert that failed after the draft landed is a state the
-- product's own retry paths can produce.
update echo.agent_session s
   set origin = 'agent'
 where s.origin = 'user'
   and (exists (select 1 from echo.agent_card    c where c.session_id = s.id)
     or exists (select 1 from echo.mail_draft    d where d.session_id = s.id)
     or exists (select 1 from echo.meeting_prep  p where p.session_id = s.id));

-- ---------------------------------------------------------------------------
-- Self-check.
--
-- THE NEGATIVE CONTROL IS THE POINT. "The brief no longer appears" passes
-- just as happily for a predicate that returns false for everything — which
-- would empty every sidebar in the product — so the check asserts BOTH
-- directions on three probe rows that differ in exactly the way the rule
-- cares about:
--
--   A  origin 'user',  no messages          → in   (a new chat, nothing said)
--   B  origin 'agent', no human turn        → OUT  (the defect's row)
--   C  origin 'agent', one human turn       → in   (they asked about it)
--
-- A and C are what make B's exclusion evidence of a rule rather than of a
-- predicate that refuses everything, and B is what makes A and C evidence of
-- a rule rather than of one that refuses nothing.
--
-- The probes need a real (org, user) pair because agent_session's composite
-- FK will not accept an invented one. On a database with no people yet the
-- probe cannot run, and that is said out loud rather than skipped silently
-- (M21) — the arm-free half of the control still runs, since a uuid with no
-- messages answers both arms of the predicate on its own.
-- ---------------------------------------------------------------------------
do $check$
declare
  v_org     uuid;
  v_user    uuid;
  v_a       uuid;
  v_b       uuid;
  v_c       uuid;
  v_in      uuid[];
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'agent_session'
       and column_name = 'origin' and is_nullable = 'NO'
  ) then
    raise exception '0221: origin is missing or nullable';
  end if;

  -- The row-free half of the control: no messages can exist for a uuid that
  -- is not a session, so this isolates the origin arm from the spoken arm.
  if echo.session_belongs_in_history('agent', gen_random_uuid()) then
    raise exception '0221: an agent-opened session with nothing said in it is in the history';
  end if;
  if not echo.session_belongs_in_history('user', gen_random_uuid()) then
    raise exception '0221: a person-opened session is NOT in the history — the rule refuses everything';
  end if;

  select u.org_id, u.id into v_org, v_user
    from echo.app_user u join echo.org o on o.id = u.org_id limit 1;

  if v_user is null then
    raise notice '0221: no people on this database, so the spoken-in arm and the constraint go unproven here; they are proven where this migration meets real rows';
  else
    -- The constraint refuses something. A check nobody proves can reject is a
    -- check that might be matching everything (0175's lesson). It sits INSIDE
    -- the people branch on purpose: with no app_user row the insert would
    -- write nothing and raise nothing, and the "it accepted a bad value" line
    -- would fire against a constraint that was never offered one.
    begin
      insert into echo.agent_session (org_id, actor_id, origin)
        values (v_org, v_user, 'machine');
      raise exception '0221: origin accepted a value that is neither user nor agent';
    exception
      when check_violation then null;
    end;

    insert into echo.agent_session (org_id, actor_id, title, origin)
      values (v_org, v_user, '0221 probe A', 'user') returning id into v_a;
    insert into echo.agent_session (org_id, actor_id, title, origin)
      values (v_org, v_user, '0221 probe B', 'agent') returning id into v_b;
    insert into echo.agent_session (org_id, actor_id, title, origin)
      values (v_org, v_user, '0221 probe C', 'agent') returning id into v_c;

    -- B and C differ ONLY in this row. B carries an assistant turn exactly
    -- as a delivered brief does, so "has any message" cannot pass for the
    -- rule; only the human turn separates them.
    insert into echo.agent_message (session_id, org_id, seq, role, content)
      values (v_b, v_org, 0, 'assistant', 'the brief'),
             (v_c, v_org, 0, 'assistant', 'the brief'),
             (v_c, v_org, 1, 'user',      'and what did they decide?');

    select coalesce(array_agg(s.id order by s.title), '{}')
      into v_in
      from echo.agent_session s
     where s.id in (v_a, v_b, v_c)
       and echo.session_belongs_in_history(s.origin, s.id);

    if v_in <> array[v_a, v_c] then
      raise exception '0221: the history contains the wrong probes (a=%, b=%, c=%, in=%)',
        v_a, v_b, v_c, v_in;
    end if;

    delete from echo.agent_message where session_id in (v_a, v_b, v_c);
    delete from echo.agent_session where id in (v_a, v_b, v_c);
  end if;

  -- The backfill reached what it exists for: no card-linked session is still
  -- claiming a person opened it. Vacuous on a fresh database, and the whole
  -- point on the one this was found on.
  if exists (
    select 1 from echo.agent_session s
     join echo.agent_card c on c.session_id = s.id
    where s.origin <> 'agent'
  ) then
    raise exception '0221: a session with an agent card is still marked as person-opened';
  end if;

  -- ...and did not reach past it. At this instant NOTHING but the backfill can
  -- have written 'agent' — no worker has run against this column yet — so
  -- every agent-marked row must be one of the three the UPDATE names. Without
  -- this half, an `update … set origin = 'agent'` with no WHERE clause at all
  -- would satisfy every assertion above and empty every sidebar in the org.
  if exists (
    select 1 from echo.agent_session s
     where s.origin = 'agent'
       and not exists (select 1 from echo.agent_card   c where c.session_id = s.id)
       and not exists (select 1 from echo.mail_draft   d where d.session_id = s.id)
       and not exists (select 1 from echo.meeting_prep p where p.session_id = s.id)
  ) then
    raise exception '0221: the backfill marked a session nothing agent-initiated points at';
  end if;
end
$check$;

commit;
