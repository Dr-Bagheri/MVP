-- 0088: the org glossary — shape wall + admin-only writes (org_admin_update).

reset role;
set local role echo_app;

-- ── the admin records terms; the whole org's transcripts benefit ──────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.org set glossary = array['محمد رضایی', 'NeurAI']
 where id = '0a000000-0000-4000-8000-00000000000a';
select t.ok(
  (select glossary from echo.org where id = '0a000000-0000-4000-8000-00000000000a')
    = array['محمد رضایی', 'NeurAI'],
  'an admin writes the glossary and reads it back');

-- ── shape wall ─────────────────────────────────────────────────────────────
select t.denied(
  $$update echo.org set glossary = array[' padded ']
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  'an untrimmed term is refused');
select t.denied(
  $$update echo.org set glossary = array['']
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  'an empty term is refused');
select t.denied(
  $$update echo.org set glossary = array[repeat('x', 61)]
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  'a 61-character term is refused');
select t.denied(
  $$update echo.org set glossary = array['dup', 'dup']
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  'duplicate terms are refused');

-- ── a MEMBER cannot write it (org_admin_update, unchanged) ────────────────
-- bob can SEE his org row (org_read), so a refused update must refuse via
-- the policy — zero rows updated, glossary unchanged
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.org set glossary = array['نفوذ']
 where id = '0a000000-0000-4000-8000-00000000000a';
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select glossary from echo.org where id = '0a000000-0000-4000-8000-00000000000a')
    = array['محمد رضایی', 'NeurAI'],
  'a member''s glossary write changes nothing — org fields stay the admins''');

-- sweep
update echo.org set glossary = '{}'
 where id = '0a000000-0000-4000-8000-00000000000a';
