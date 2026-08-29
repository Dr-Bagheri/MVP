-- The agent's authority, which is only ever borrowed.
--
-- Everything here runs as echo_agent with a real person's identity attached —
-- the same shape as a tool call inside a run. What the agent may do is the
-- intersection of that person's rows (RLS) and the agent's columns (grants).
-- No prompt is involved in any of it, which is the point: prompts are never
-- the wall.

reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

-- --- it reads exactly what its caller reads --------------------------------
select t.ok((select count(*) from echo.call) = 2,
  'the agent sees the two calls bob can open, and no more');
select t.ok(not exists (select 1 from echo.call where id = 'c3000000-0000-4000-8000-000000000003'),
  'running for bob, the agent cannot see carol''s private call');

-- --- it deletes nothing, ever (M11) ----------------------------------------
select t.denied($$delete from echo.call$$,
  'the agent holds no DELETE on calls');
select t.denied($$delete from echo.transcript_segment$$,
  'nor on transcripts');
select t.denied($$delete from echo.summary$$,
  'nor on summaries');
select t.denied($$delete from echo.call_speaker$$,
  'nor on speakers');
select t.denied($$delete from echo.person$$,
  'nor on the speaker directory');
select t.denied($$delete from echo.call_part$$,
  'nor on audio parts');
select t.denied($$delete from echo.agent_run$$,
  'nor on its own audit trail');

-- Belt and braces: ask the catalogue, not just the statements. A future
-- migration that grants in bulk has to survive this line.
reset role;
select t.ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'echo_agent' and privilege_type = 'DELETE'
  ),
  'echo_agent holds no DELETE grant on any table in the database');

/*
 * ...and no DELETE through a DOOR either (0130, from the 2026-08-29 audit).
 *
 * The check above was true the whole time `delete_summary_version` sat there
 * with PUBLIC's default EXECUTE, because a security-definer function that
 * deletes is structurally invisible to `role_table_grants` — the view is
 * about TABLES. So "the agent holds no DELETE grant on any table" was true,
 * and "the agent deletes nothing, ever" was not. Two different sentences,
 * and the wall means the second one.
 *
 * pg_proc.proacl is the instrument that can tell them apart. A NULL acl is
 * the trap: it means "defaults", and the default for a function is EXECUTE
 * to PUBLIC — so a door that simply forgot its revoke reads as null here,
 * which is exactly the state this catches.
 */
select t.ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo'
       and p.prosecdef
       and pg_get_functiondef(p.oid) ilike '%delete from%'
       and has_function_privilege('echo_agent', p.oid, 'EXECUTE')
  ),
  'echo_agent can execute no security-definer function that deletes');

/*
 * The same rule stated as structure rather than as a consequence: NO
 * security-definer door in `echo` is PUBLIC's to call.
 *
 * `has_function_privilege('public', …)` is the question that discriminates,
 * and the first draft of this check got it wrong in an instructive way: it
 * asked whether proacl was NULL. That would have stayed green through the
 * entire life of the bug, because 0095 DID grant to echo_app explicitly —
 * the ACL was non-null and still admitted everyone. Verified both ways by
 * staging the grant back: `public` answers true with the bug, false without.
 *
 * Absolute, with no allow-list. An allow-list of harmless entries is where
 * the next one would hide.
 */
select t.ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo'
       and p.prosecdef
       and has_function_privilege('public', p.oid, 'EXECUTE')
  ),
  'no security-definer door in echo is PUBLIC''s to call');
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

-- --- its reach into a call row is EXACTLY two columns ----------------------
-- 0108 (M41 P3) widened this deliberately: a human-approved workflow apply
-- writes tags and title ON the agent role, owner-only. What this check
-- guarded — "replace a summary" must never become "change the scope of
-- this call" or "delete it softly" — still holds, one column-grant tighter:
-- everything BEYOND the two approved columns stays refused. (95_workflow_
-- writes.sql walks the positive half and the owner-only policy.)
select t.denied(
  $$update echo.call set scope = 'private' where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'the agent cannot re-scope a call — its reach is tags and title, nothing more');
select t.denied(
  $$update echo.call set deleted_at = now() where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'so it cannot soft-delete either — the no-delete rule has no back door');
select t.denied(
  $$insert into echo.call (org_id, owner_id, title)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002', 'ساخته‌شده توسط ایجنت')$$,
  'and it cannot create one');

-- --- the three things it may write -----------------------------------------
update echo.transcript_segment set text = 'سلام، قیمت کتاب پنج میلیون تومان است'
 where id = 'a1000000-0000-4000-8000-000000000001';
select t.ok(
  (select edited_by = '02000000-0000-4000-8000-000000000002'
     from echo.transcript_segment where id = 'a1000000-0000-4000-8000-000000000001'),
  'tool 1: correct a transcript line on its caller''s own call');

update echo.call_speaker set label = 'رضا'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select label from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001') = 'رضا',
  'tool 2: rename a voice in the roster');

insert into echo.summary (call_id, org_id, body, model, created_by)
values ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'خلاصه‌ای که ایجنت نوشت', 'test/model', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select count(*) from echo.summary where call_id = 'c1000000-0000-4000-8000-000000000001') = 1,
  'tool 3: write a new summary version');

-- --- and nothing beyond those columns --------------------------------------
select t.denied(
  $$update echo.transcript_segment set confidence = 1
     where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'the agent has no grant on a segment''s confidence');
select t.denied(
  $$update echo.transcript_segment set provenance = '{"faked":true}'
     where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'nor on its provenance — it cannot dress its own output up as the STT''s');
select t.denied(
  $$update echo.summary set body = 'x' where id = 'b2000000-0000-4000-8000-000000000002'$$,
  'nor any grant to edit a summary in place');
select t.denied(
  $$select email from echo.app_user limit 1$$,
  'the agent cannot read anyone''s email address');
select t.denied($$select * from echo.api_key$$,
  'nor the gateway''s API keys');
select t.denied($$select * from echo.admin_action$$,
  'nor the admin audit log');

-- --- writes follow the caller, not the reader ------------------------------
-- carol can READ the org-scoped call. That must not make it writable: "an
-- admin who can read every call still cannot rewrite one they don't own"
-- applies to every reader, admin or not.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok(exists (select 1 from echo.transcript_segment
                    where call_id = 'c2000000-0000-4000-8000-000000000002'),
  'running for carol, the agent can read the org-scoped call');
select t.writes_nothing(
  $$update echo.transcript_segment set text = 'دستکاری'
     where call_id = 'c2000000-0000-4000-8000-000000000002'$$,
  'but cannot correct a line on a call carol does not own');
select t.writes_nothing(
  $$insert into echo.summary (call_id, org_id, body, model, created_by)
    values ('c2000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-00000000000a',
            'خلاصه غیرمجاز','test/model','03000000-0000-4000-8000-000000000003')$$,
  'and cannot add a summary version to it');

-- --- an admin's agent is still not a writer --------------------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok((select count(*) from echo.call) = 5,
  'running for the admin, the agent reads the whole org');
select t.writes_nothing(
  $$update echo.transcript_segment set text = 'دستکاری مدیر'
     where call_id = 'c1000000-0000-4000-8000-000000000001'$$,
  'and still cannot rewrite a line on a call the admin does not own (SPEC)');

reset role;
