-- 0085: the deletion ledger — reasoned doors, admin-read, both directions.

reset role;
set local role echo_app;

-- ── a call delete with a reason writes the ledger ─────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
-- bob's own call c2 (org-scoped, alive at this point in the suite)
select t.denied(
  $$select echo.soft_delete_call('c2000000-0000-4000-8000-000000000002', ' ')$$,
  'a blank reason is refused — the reasoned door does not delete');
select t.ok(
  echo.soft_delete_call('c2000000-0000-4000-8000-000000000002', 'جلسهٔ آزمایشی بود'),
  'a member deletes their own record WITH a reason');
select t.ok(
  not exists (select 1 from echo.call where id = 'c2000000-0000-4000-8000-000000000002'),
  'and it is gone for them exactly as the one-argument door always behaved');
select t.ok(
  not echo.soft_delete_call('c2000000-0000-4000-8000-000000000002', 'دوباره'),
  'deleting again is false — idempotent, and no second ledger line');

-- ── the ledger: admins read it, members do not, content is absent ─────────
select t.ok(
  not exists (select 1 from echo.deletion_record),
  'the MEMBER who wrote the line cannot read the ledger — it is the admins'' surface');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select count(*) from echo.deletion_record
    where kind = 'call' and target_id = 'c2000000-0000-4000-8000-000000000002'
      and actor_id = '02000000-0000-4000-8000-000000000002'
      and reason = 'جلسهٔ آزمایشی بود') = 1,
  'the admin reads WHO deleted WHICH record and WHY — exactly one line');

-- ── the refusal path leaves NO ledger line (the wall runs first) ──────────
-- bob (02): ACTIVE member — carol would be denied for being tombstoned,
-- which would pass this test for the wrong reason
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select echo.soft_delete_call('c7000000-0000-4000-8000-000000000007', 'نفوذ')$$,
  'the reasoned door re-runs the same wall — a member still cannot delete the owner''s record');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  not exists (select 1 from echo.deletion_record where reason = 'نفوذ'),
  'and a refused attempt writes nothing — the ledger records deletions, not wishes');

-- ── person door: reason required, ledger written ──────────────────────────
insert into echo.person (id, org_id, display_name, created_by) values
  ('88000000-0000-4000-8000-000000000088', '0a000000-0000-4000-8000-00000000000a',
   'شخص آزمایشی', '01000000-0000-4000-8000-000000000001');
select t.ok(
  echo.delete_person('88000000-0000-4000-8000-000000000088', 'ورودی تکراری بود'),
  'an admin deletes a person with a reason');
select t.ok(
  exists (select 1 from echo.deletion_record
           where kind = 'person' and target_id = '88000000-0000-4000-8000-000000000088'),
  'and the ledger holds the person deletion');

-- ── member door: the tombstone with a reason ──────────────────────────────
select t.ok(
  echo.tombstone_user('04000000-0000-4000-8000-000000000004', 'همکاری پایان یافت'),
  'the owner tombstones a member with a reason');
select t.ok(
  exists (select 1 from echo.deletion_record
           where kind = 'member' and target_id = '04000000-0000-4000-8000-000000000004'
             and reason = 'همکاری پایان یافت'),
  'and the ledger holds the member deletion');
