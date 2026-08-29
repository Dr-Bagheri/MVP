-- 0131 — no security-definer door in `echo` is PUBLIC's to call.
--
-- 0130 closed the one door that mattered (`delete_summary_version`, the only
-- DELETE-bearing function the agent could reach). This closes the rule.
--
-- WHY A SECOND FILE: 0130 was already applied when the last four doors were
-- found, and a migration that has run is immutable — the runner refused the
-- edit, which is the append-only discipline doing its job. Recorded rather
-- than tidied away, because the refusal is the feature.
--
-- ── the check that ships with this, and the first draft that was wrong ──
-- db/test/30_agent_wall.sql now asks
-- `has_function_privilege('public', oid, 'EXECUTE')`. The first draft asked
-- whether `proacl is null`, and that check would have stayed GREEN through
-- the entire life of the bug: 0095 DID grant to echo_app explicitly, so the
-- ACL was non-null and still admitted everyone. Proven by staging the grant
-- back on the live catalogue — `public` answers true with the bug present,
-- false once revoked. A check that cannot fail for its own reason is worse
-- than none, so the wrong draft is named here rather than deleted quietly.
--
-- ── why no allow-list ───────────────────────────────────────────────────
-- None of these four deletes, and two are trigger functions (a trigger fires
-- without consulting EXECUTE, so nothing depends on their grant). They could
-- have been an allow-list of "harmless" entries — which is exactly where the
-- next one would hide. An absolute rule with no exceptions cannot rot.
--
-- ── why the grants come first ───────────────────────────────────────────
-- `actor_is_owner` and `owns_agent_session` are called from RLS POLICIES, and
-- a policy runs as the CALLER. Revoking PUBLIC without naming the roles first
-- would turn those policies from "filter" into "raise". The role lists below
-- are read from pg_policy on the live catalogue, not guessed:
--   actor_is_owner      → invitation_issue, role_capability_write   (echo_app)
--   owns_agent_session  → agent_message_own      (echo_app, echo_agent)
--                         agent_message_write, agent_message_feedback_own,
--                         agent_session_share_own                   (echo_app)

begin;

grant execute on function echo.actor_is_owner() to echo_app;
revoke all on function echo.actor_is_owner() from public;

grant execute on function echo.owns_agent_session(uuid) to echo_app, echo_agent;
revoke all on function echo.owns_agent_session(uuid) from public;

revoke all on function echo.tg_agent_run_stamp_messages() from public;
revoke all on function echo.tg_segment_words_demote() from public;

commit;
