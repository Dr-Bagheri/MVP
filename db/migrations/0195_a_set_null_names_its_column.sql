-- 0195 — a SET NULL names its column: four composite foreign keys whose
-- cascade could only ever raise.
--
-- ── THE DEFECT, AND WHY IT HAD TWO OLDER SIBLINGS ─────────────────────────
--
-- 0188 (2026-09-04) recorded the trap in its own words: "a composite FK's
-- cascade action applies to the WHOLE KEY, so `set null` on a key containing a
-- NOT NULL column is a constraint that can only ever raise" — and fixed the
-- one it had just shipped (task.recurrence_id). 0191 met the trap again from
-- the other side the next day. Neither looked BACKWARDS, and the production
-- catalogue (read 2026-09-06, the check-up) still held four:
--
--   echo.task.task_call_org                 (call_id, org_id)    → echo.call
--   echo.meeting.meeting_call_org           (call_id, org_id)    → echo.call
--   echo.agent_card.agent_card_session_same_org (session_id, org_id) → echo.agent_session
--   echo.meeting.meeting_topic_same_org     (topic_id, org_id)   → echo.meeting_topic
--
-- What each one did in practice:
--
--   · the 30-day ROW PURGE (core/src/purge) deletes `echo.call` after the
--     objects are gone. For a call a meeting or a task points at — which is
--     every meeting the product now records by default — the delete tried to
--     write org_id = NULL on the pointing row, raised 23502, and the per-call
--     transaction rolled back "to retry next run", forever: the audio was
--     gone and the transcript, summary and speakers stayed indefinitely. M11's
--     promise ("the row is the map to the object; delete the map last") was
--     kept only for calls nothing pointed at.
--   · `platform_purge_org` deletes `agent_session` (0160's order) BEFORE
--     `agent_card`; an org whose assistant ever delivered a brief could not be
--     purged at all — the whole function raised on the first card.
--   · `meeting_topic` is latent (nothing deletes a folder today), fixed in the
--     same breath because the day something does, it would raise the same way.
--
-- 0029 knew (its own comment: "on delete set null (call_id) … because org_id
-- is NOT NULL and a whole-row SET NULL would fail"); the knowledge sat in one
-- file and every later author wrote the constraint from the general form.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────
--
-- The composite pairing STAYS (D9 / rule 11: structure rather than a policy
-- subquery, so a row and what it points at can never belong to two
-- organisations); only the cascade narrows to the column that is actually
-- nullable. Postgres 15+ syntax; the server is 17.
--
-- ── AND THE CLASS, SO THIS IS THE LAST TIME ───────────────────────────────
--
-- The catalogue can answer "is there a composite SET NULL foreign key with no
-- column list whose key holds a NOT NULL column" in one query, so the class
-- is asserted at the foot of this file and, standing, in db/test/109 — with a
-- negative control there that stages exactly such a constraint and watches
-- the query find it. 0188's lesson as a check instead of a sentence.

begin;

alter table echo.task
  drop constraint task_call_org,
  add constraint task_call_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null (call_id);

alter table echo.meeting
  drop constraint meeting_call_org,
  add constraint meeting_call_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null (call_id);

alter table echo.meeting
  drop constraint meeting_topic_same_org,
  add constraint meeting_topic_same_org
    foreign key (topic_id, org_id) references echo.meeting_topic (id, org_id)
    on delete set null (topic_id);

alter table echo.agent_card
  drop constraint agent_card_session_same_org,
  add constraint agent_card_session_same_org
    foreign key (session_id, org_id) references echo.agent_session (id, org_id)
    on delete set null (session_id);

-- ── self-check 1: the ordinary path, ATTEMPTED ────────────────────────────
/*
 * Not "does the constraint read right" — every one of the four did. A call
 * with a meeting AND a task pointing at it is deleted; both must survive with
 * their org intact and their pointer cleared. Then a session with a card,
 * and a topic with a meeting, the same way. Owner altitude, as the purge runs.
 */
do $chk$
declare
  v_org     uuid;
  v_user    uuid;
  v_call    uuid;
  v_meeting uuid;
  v_col     uuid;
  v_task    uuid;
  v_session uuid;
  v_card    uuid;
  v_topic   uuid;
  v_meeting2 uuid;
begin
  select u.org_id, u.id into v_org, v_user
    from echo.app_user u join echo.org o on o.id = u.org_id
   where u.status = 'active' limit 1;
  if v_org is null then
    raise notice '0195: no active member to probe with — constraints changed, ordinary path unproven here';
    return;
  end if;

  insert into echo.call (org_id, owner_id, title, scope, status)
  values (v_org, v_user, '__0195_probe__', 'private', 'ready') returning id into v_call;
  insert into echo.meeting (org_id, title, scheduled_at, call_id, created_by)
  values (v_org, '__0195_probe__', now(), v_call, v_user) returning id into v_meeting;
  insert into echo.task_column (org_id, name, tone, position, created_by)
  values (v_org, '__0195_probe__', 'grey', 9999, v_user) returning id into v_col;
  insert into echo.task (org_id, column_id, title, call_id, created_by)
  values (v_org, v_col, '__0195_probe__', v_call, v_user) returning id into v_task;

  delete from echo.call where id = v_call;

  if (select org_id from echo.meeting where id = v_meeting) is null then
    raise exception 'CHECK FAILED: deleting a call nulled the meeting''s org_id';
  end if;
  if (select call_id from echo.meeting where id = v_meeting) is not null then
    raise exception 'CHECK FAILED: deleting a call left the meeting pointing at it';
  end if;
  if (select org_id from echo.task where id = v_task) is null then
    raise exception 'CHECK FAILED: deleting a call nulled the task''s org_id';
  end if;
  if (select call_id from echo.task where id = v_task) is not null then
    raise exception 'CHECK FAILED: deleting a call left the task pointing at it';
  end if;

  insert into echo.agent_session (org_id, actor_id, title)
  values (v_org, v_user, '__0195_probe__') returning id into v_session;
  insert into echo.agent_card (org_id, owner_id, kind, title, session_id)
  values (v_org, v_user, 'post_call_brief', '__0195_probe__', v_session) returning id into v_card;
  delete from echo.agent_session where id = v_session;
  if (select org_id from echo.agent_card where id = v_card) is null
     or (select session_id from echo.agent_card where id = v_card) is not null then
    raise exception 'CHECK FAILED: deleting a session did not clear the card''s pointer cleanly';
  end if;

  insert into echo.meeting_topic (org_id, name, created_by)
  values (v_org, '__0195_probe__', v_user) returning id into v_topic;
  insert into echo.meeting (org_id, title, scheduled_at, topic_id, created_by)
  values (v_org, '__0195_probe_2__', now(), v_topic, v_user) returning id into v_meeting2;
  delete from echo.meeting_topic where id = v_topic;
  if (select org_id from echo.meeting where id = v_meeting2) is null
     or (select topic_id from echo.meeting where id = v_meeting2) is not null then
    raise exception 'CHECK FAILED: deleting a topic did not clear the meeting''s pointer cleanly';
  end if;

  delete from echo.agent_card where id = v_card;
  delete from echo.meeting where id in (v_meeting, v_meeting2);
  delete from echo.task where id = v_task;
  delete from echo.task_column where id = v_col;
end $chk$;

-- ── self-check 2: the CLASS is empty ─────────────────────────────────────
/*
 * Every composite foreign key in echo whose delete action is SET NULL must
 * name its columns when the key holds a NOT NULL column. This is the query
 * that found the four; it must now find none.
 */
do $chk$
declare
  v_bad text;
begin
  select string_agg(conrelid::regclass::text || '.' || conname, ', ' order by conname)
    into v_bad
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'echo'::regnamespace
     and c.confdeltype = 'n'
     and array_length(c.conkey, 1) > 1
     and coalesce(array_length(c.confdelsetcols, 1), 0) = 0
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attnotnull
     );
  if v_bad is not null then
    raise exception 'CHECK FAILED: composite SET NULL keys that can only raise: %', v_bad;
  end if;
end $chk$;

commit;
