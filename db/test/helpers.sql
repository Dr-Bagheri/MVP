-- Test helpers. Test-only: `t` is dropped by reset and never ships.
--
-- Three shapes of assertion, because the wall denies in three different ways:
--   t.ok(cond, label)          — a plain claim about what is visible
--   t.denied(stmt, label)      — the statement must raise (grants, triggers)
--   t.writes_nothing(stmt, l)  — the statement must touch zero rows, or raise
--                                (RLS does not raise; it filters silently,
--                                 and a silent filter is still a denial)

create schema if not exists t;
-- Every role in the suite calls these, including the ones we are proving are
-- powerless. USAGE on a schema is not granted by default.
grant usage on schema t to public;

create or replace function t.ok(cond boolean, label text) returns void
  language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'ok  %', label;
end;
$$;

create or replace function t.denied(stmt text, label text) returns void
  language plpgsql as $$
declare
  raised boolean := false;
  why    text;
begin
  begin
    execute stmt;
  exception when others then
    raised := true;
    why := sqlerrm;
  end;
  if not raised then
    raise exception 'FAIL: % — the statement was allowed and must not be', label;
  end if;
  raise notice 'ok  % [%]', label, why;
end;
$$;

/*
 * `writes_nothing` means "the POLICY refuses this caller". It used to accept
 * any exception as proof, and that made it blind to the one nothing it must
 * never accept.
 *
 * ── the bug it hid, found 2026-08-29 by a user ────────────────────────────
 * `echo.agent_workflow` carried `echo_app=ar` — SELECT and INSERT, no UPDATE
 * of any kind. So `update … set enabled = false` raised 42501 "permission
 * denied for table" for EVERYONE, and this helper recorded that as the
 * policy correctly filtering a member out. The test read
 * "an admin cannot rearrange a member's private agent" and passed because
 * nobody could rearrange anything at all; the whole feature was dead and the
 * suite was green.
 *
 * Two different nothings wearing one answer, which is rule 12 arriving inside
 * a test helper. A refusal by GRANT is a claim about the table — it is true
 * for every caller, so it can never be evidence about THIS one.
 *
 * ── how they are told apart ───────────────────────────────────────────────
 * Both are SQLSTATE 42501, so the sqlstate cannot discriminate and the
 * message is the only thing that can. Postgres says "permission denied for
 * table/relation/column …" when a grant is missing and "new row violates
 * row-level security policy" when a policy refuses. Matching on message text
 * is normally the wrong instrument in this repo; it is the only available one
 * here, and the failure direction is safe — a message this does not
 * recognise falls through to the old behaviour rather than passing something
 * new. (It assumes the server's lc_messages is English, which is true of
 * every database this suite runs against.)
 */
create or replace function t.writes_nothing(stmt text, label text) returns void
  language plpgsql as $$
declare
  n       bigint := 0;
  blocked boolean := false;
  why     text := 'filtered to zero rows';
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n = 0 then blocked := true; end if;
  exception when others then
    if sqlerrm like 'permission denied for%' then
      raise exception 'FAIL: % — refused by a missing GRANT, not by the policy (%). '
        'That is true for every caller, so it proves nothing about this one, '
        'and it means the write is dead for the people who SHOULD have it.',
        label, sqlerrm;
    end if;
    blocked := true;
    why := sqlerrm;
  end;
  if not blocked then
    raise exception 'FAIL: % — % row(s) were written', label, n;
  end if;
  raise notice 'ok  % [%]', label, why;
end;
$$;

-- Becoming a caller is done inline in each test file, never through a helper:
--
--   reset role;
--   set local role echo_app;
--   select set_config('echo.actor_id', '<uuid>', true);
--
-- Two reasons. It is exactly what core/'s connection factory does (a database
-- role plus SET LOCAL identity), so a reader can check the tests against the
-- real thing; and hiding a SET ROLE inside a function invites questions about
-- when it reverts that the tests should not have to answer.
