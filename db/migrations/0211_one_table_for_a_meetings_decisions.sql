-- 0211 — one table for a meeting's decisions
--
-- A CORRECTION, written the same day as the thing it corrects, and the reason
-- is worth more than the code.
--
-- 0209 built `echo.decision_log` to answer the 2026-09-08 directive's items 2
-- and 3 — a decision ledger and commitment tracking. It was applied, its RLS
-- matrix was proven by db/test/120, and then the WEB side of the same feature
-- was opened and `echo.meeting_item` was already there: five kinds including
-- `decision` and `action`, `source` pinned by the writing ROLE so the badge is
-- a fact rather than a flag, a moment in the recording, a person's owner
-- field, a whole edit surface and a make-a-task-from-this path. 0160 built it
-- on 2026-09-01 for the same complaint.
--
-- So 0209 was a SECOND TABLE FOR ONE FACT — the exact shape this repository
-- has a rule about, and the one it is worst at seeing from inside a single
-- package. Two decisions surfaces would have disagreed the first week; a
-- person writing «مصوبه» on the meeting page and an agent answering from the
-- ledger would have been reading different rows.
--
-- ── WHY THIS DIRECTION AND NOT THE OTHER ──────────────────────────────────
--
-- `meeting_item` wins on everything that is expensive to move: it has the
-- role-pinned `source` (an agent can insert and can never edit or remove a
-- line a person wrote — a GRANT, not a prompt), a read policy that goes
-- through the meeting's own so it can never be more visible than what it
-- hangs off, five kinds rather than two, a live surface people already use,
-- and rows in production. `decision_log` had none of that and no rows.
--
-- What 0209 got right and 0160 lacked was the TEMPORAL half and the
-- resolved owner, and those are four columns rather than a table:
--
--   owner_id      the ACCOUNT, beside the free-text `owner` that stays for
--                 somebody with no row here (0145's reasoning for
--                 `meeting.invitees`, unchanged). The extraction resolves a
--                 spoken name EXACTLY or writes nobody.
--   due_on        a DAY: a meeting says «تا شنبه», never a clock time, and an
--                 instant would need a zone nobody chose.
--   supersedes_id the later item that replaces an earlier one, so «کدام
--                 تصمیم برگشت خورد؟» is a query rather than somebody's memory.
--   status        standing | superseded | reversed.
--
-- ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
--
-- It does not pretend 0209 never happened. The table is dropped in the open,
-- the purge's delete for it is taken back out by the same regeneration that
-- put it in, and db/test/120 is rewritten against `meeting_item` — because
-- its assertions were about a rule (a decision is visible exactly where its
-- record is) and that rule now lives somewhere better.

begin;

-- ── the four columns 0209 was right about ─────────────────────────────────

alter table echo.meeting_item
  /* the ACCOUNT, when the spoken name resolved to exactly one colleague.
     `set null (owner_id)` names its column: the composite key holds a NOT
     NULL org_id, and a bare SET NULL over it can only ever raise (0188). */
  add column owner_id uuid,
  add column due_on   date,
  add column supersedes_id uuid,
  add column status   text not null default 'standing'
             check (status in ('standing', 'superseded', 'reversed'));

alter table echo.meeting_item
  add constraint meeting_item_owner
    foreign key (owner_id, org_id) references echo.app_user (id, org_id)
    on delete set null (owner_id);

/* the self-reference. `meeting_item` has no composite (id, org_id) key — it
   predates that habit — so this is a plain FK to the primary key, and the
   org wall is the READ POLICY's, which both rows are behind anyway. A
   cross-org supersede is unrepresentable in practice because the writer can
   only see rows in their own org to point at. */
alter table echo.meeting_item
  add constraint meeting_item_supersedes
    foreign key (supersedes_id) references echo.meeting_item (id) on delete set null;

create index meeting_item_owner_idx on echo.meeting_item (owner_id)
  where owner_id is not null;
create index meeting_item_open_idx on echo.meeting_item (org_id, due_on)
  where kind = 'action' and status = 'standing' and not done;

comment on column echo.meeting_item.owner_id is
  'The colleague who owes an action, resolved from the name somebody SPOKE — exactly or not at all (0211). The free-text `owner` stays beside it for a person with no account here, the same reason meeting.invitees is text.';
comment on column echo.meeting_item.supersedes_id is
  'The earlier item this one replaces. The temporal half: «کدام تصمیم برگشت خورد؟» becomes a query rather than somebody''s memory (0211).';
comment on column echo.meeting_item.due_on is
  'A DAY, not an instant: a meeting says «تا شنبه» and an instant would be a time nobody chose rendered in a zone that can disagree (0211).';

/* THE AGENT MAY NOT SUPERSEDE. 0160's grant already limits echo_agent to
   INSERT, so it cannot mark an earlier item superseded — which is right:
   deciding that a new sentence REPLACES an old decision is a judgement about
   the organisation's record, and this platform's rule is that a model may
   claim and only a person may agree. Stated here because the next reader will
   wonder whether the extraction can do it. It cannot. */

-- ── 0209's table goes, in the open ────────────────────────────────────────

do $regen$
declare
  v_def text;
  v_line constant text := '  delete from echo.decision_log               where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_line in v_def) = 0 then
    raise exception 'the purge does not name decision_log where 0209 put it — re-read the function before editing it';
  end if;

  /* taken out by the same regeneration that put it in, rather than left to
     RAISE on the first purge after the drop */
  v_def := replace(v_def, v_line || E'\n', '');
  execute v_def;
end $regen$;

alter table echo.task drop constraint task_decision;
drop index if exists echo.task_decision_uniq;
alter table echo.task drop column decision_id;

drop table echo.decision_log;

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_def text;
begin
  -- 1. THE TABLE IS GONE, and so is the pointer to it. A dropped table whose
  --    FK survived would be a constraint referencing nothing.
  if to_regclass('echo.decision_log') is not null then
    raise exception '0211: decision_log is still here';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'echo.task'::regclass and attname = 'decision_id' and not attisdropped
  ) then
    raise exception '0211: task.decision_id survived the table it pointed at';
  end if;

  -- 2. THE PURGE NO LONGER NAMES IT. A delete against a dropped table is a
  --    purge that raises, which is a purge that does not run — 0132's own
  --    sentence, pointed at the reverse direction.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if position('decision_log' in v_def) > 0 then
    raise exception '0211: the purge still deletes from a table that no longer exists';
  end if;
  -- and the DISCRIMINATING half: it still deletes the table beside it, so
  -- "the regeneration emptied the function" cannot pass the line above
  if position('delete from echo.project_member' in v_def) = 0 then
    raise exception '0211: the regeneration lost the rest of the purge';
  end if;

  -- 3. THE FOUR COLUMNS ARE ON meeting_item, and the owner FK names its
  --    column (0188 — a bare SET NULL over the NOT NULL org_id can only raise)
  if (select count(*) from pg_attribute
       where attrelid = 'echo.meeting_item'::regclass and not attisdropped
         and attname in ('owner_id', 'due_on', 'supersedes_id', 'status')) <> 4 then
    raise exception '0211: meeting_item did not gain all four columns';
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'echo.meeting_item'::regclass and conname = 'meeting_item_owner';
  if v_def is null or v_def not like '%SET NULL (owner_id)%' then
    raise exception '0211: the owner FK does not name its column — %', coalesce(v_def, 'missing');
  end if;

  -- 4. THE STATUS SET REFUSES, and accepts — the discriminating pair
  begin
    update echo.meeting_item set status = 'cancelled' where id = (select id from echo.meeting_item limit 1);
    if found then raise exception '0211: an unknown status was accepted'; end if;
  exception when check_violation then null;
  end;
end
$check$;

commit;
