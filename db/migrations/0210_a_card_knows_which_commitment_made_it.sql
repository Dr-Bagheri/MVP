-- 0210 — a card knows which commitment made it
--
-- 0209 gave the platform a decision log, and confirming a COMMITMENT files a
-- card. This is the pointer that makes that traceable in the direction it is
-- actually read: from the card back to the sentence somebody said.
--
-- ── WHY THE POINTER GOES THIS WAY ─────────────────────────────────────────
--
-- The other direction — `decision_log.task_id` — was the first draft, and it
-- is wrong for two reasons. A ledger's rows are written once and superseded,
-- never edited into place, so a forward pointer means UPDATING a row whose
-- whole value is that it does not change. And a card can outlive the
-- commitment's call (0209's `set null (call_id)`), so the card is the durable
-- end of the pair.
--
-- One card per commitment: confirming twice is idempotent in core, and the
-- partial unique index is the half that makes it true when core is not the
-- only caller.
--
-- The cascade names its column (0188), like every other pointer added this
-- week: the composite key holds a NOT NULL org_id, so a bare SET NULL over it
-- can only ever raise.

begin;

alter table echo.task add column decision_id uuid;

alter table echo.task
  add constraint task_decision
    foreign key (decision_id, org_id) references echo.decision_log (id, org_id)
    on delete set null (decision_id);

create unique index task_decision_uniq on echo.task (decision_id)
  where decision_id is not null;

comment on column echo.task.decision_id is
  'The commitment this card was filed from (0209/0210). Read from the card back to the sentence somebody said — a card can outlive the call, so the card is the durable end of the pair.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'echo.task'::regclass and conname = 'task_decision';
  if v_def is null then
    raise exception '0210: the pointer is missing';
  end if;
  if v_def not like '%SET NULL (decision_id)%' then
    raise exception '0210: the cascade does not name its column — %', v_def;
  end if;

  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'task_decision_uniq' and i.indisunique
  ) then
    raise exception '0210: one card per commitment is not enforced';
  end if;
end
$check$;

commit;
