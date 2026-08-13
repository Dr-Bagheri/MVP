-- Echo — 0053: make "don't leak transactions" a setting instead of a rule.
--
-- A harness crashed between `begin` and `rollback` and left an echo_app
-- connection idle in transaction for thirty-two minutes, holding locks on
-- echo.org. It blocked ALL DDL on the shared project for every session, and
-- the person who noticed was three packages away from the cause with the least
-- ability to fix it — the owner saw a passing test file and moved on, because
-- from their seat a leak and a hang look identical and only the hang stops
-- anything of theirs.
--
-- The fix that ends the class is not vigilance. Postgres will end an idle
-- transaction on its own if we say how long is too long.
--
-- Five minutes, not thirty seconds. The number has to clear the longest gap a
-- LEGITIMATE transaction might have between statements, and the one shape that
-- could come close is an agent loop holding a transaction open across a model
-- call. Measured assistant turns run ~17s at the slowest, so five minutes is
-- roughly twenty times the worst observed — while still bounding a leak to
-- something nobody has to notice, ask permission about, or authorise.
--
-- Erring long on purpose: killing a live transaction is a visible failure in
-- someone's request, and reaping a leak five minutes later than strictly
-- necessary costs nothing. Same asymmetry as run_stall_window(), same
-- direction.
--
-- Everywhere rather than dev-only. A transaction idle for five minutes is a
-- bug in any environment, and in production it holds locks against real work.
-- If a deployment ever has a legitimate reason to sit longer, that is a
-- deliberate ALTER ROLE with a reason, not a default nobody chose.

do $$
declare r text;
begin
  foreach r in array array['echo_app', 'echo_agent', 'echo_purge', 'echo_vendor'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'alter role %I set idle_in_transaction_session_timeout = %L', r, '5min');
    end if;
  end loop;
end;
$$;

-- Deliberately NOT set on the owner/migration role. A migration that pauses
-- mid-run — a long ALTER, a manual operator session applying a fix — is not a
-- leak, and having the connection performing schema surgery reaped on a timer
-- is a worse failure than the one this prevents.
