-- 0154 — indexes for the timer sweeps, the trigger match, and three lists.
--
-- ── RENUMBERED FROM 0132 ON 2026-09-08 (review F12) ────────────────────────
--
-- Two files were numbered 0132: this one and `0132_the_webhook_feature_goes`.
-- Both applied, because `migrationFiles()` keys the ledger on the full
-- filename; they were ordered by a plain `.sort()`, i.e. alphabetically, and
-- `…sweeps…` happening to sort before `…webhook…` was the only thing keeping
-- the order safe. The NUMBER is the ordering contract, and it was being kept
-- by the alphabet. A future `0132_a_…` needing to run after the webhook file
-- would silently have run before it.
--
-- **THIS half moved, and the other one must never move.** Not a coin toss:
-- `0132_the_webhook_feature_goes` writes a LITERAL SNAPSHOT of
-- `echo.platform_purge_org`'s whole body — its own header says so — and
-- FOURTEEN later migrations modify that function (0145, 0147, 0151, 0159,
-- 0160, 0165, 0166, 0182, 0185, 0187, 0190, 0195, 0201, 0202). Moving it to
-- the tail would reinstate its 0132-era body over all fourteen, silently
-- dropping the deletes they exist to add, on the one path in the product
-- where failing to delete is the worst possible outcome. Worse, its own
-- post-hoc assertions would not catch that: they check for `echo.call`,
-- `echo.app_user`, `echo.agent_message`, `echo.connector_secret` and the
-- audit insert — all 0132-era — so a body that had lost `echo.project`,
-- `echo.chat_reaction`, `echo.agent_room` and `echo.join_invite` passes every
-- one of them.
--
-- **Why this file is safe to move, which is the claim a future reader needs
-- and cannot reconstruct:** it is `create index` and nothing else. Every table
-- and column it names still exists at 0207; none of its eight index names
-- occurs in any other migration (checked); nothing between here and the tail
-- drops one. It has no ordering relationship with anything after it, so
-- moving it changes no end state.
--
-- **0154 rather than the tail.** It is the sequence's one genuine gap — and
-- the gap existed precisely BECAUSE of this duplicate, so taking it puts the
-- count right at the same time. The tail (0207) is contested by whatever
-- lands next; a gap is not.
--
-- ── THE LEDGER STEP, WHICH IS NOT OPTIONAL ────────────────────────────────
--
-- Renumbering changes the ledger `version`. A database that already applied
-- this file as 0132 must be told once, or `migrate` re-runs it and the first
-- `create index` fails with "relation already exists":
--
--     update public.echo_migration
--        set version = '0154_the_sweeps_get_their_indexes'
--      where version = '0132_the_sweeps_get_their_indexes';
--
-- Recorded here rather than only in a review, because an operational step
-- written somewhere else is a step nobody performs.
--
-- **NOT YET APPLIED ANYWHERE.** The uniqueness assertion in `db.mjs` is
-- proven; this file's execution at its new position is not — there is no
-- database in the environment this was done in.
--
-- From the 2026-08-29 audit, Part 3 item 4: `echo.workflow` had NO index on
-- `trigger_event` at all while being scanned on every product event, and the
-- mail/calendar/wait/agent-rule sweeps all seq-scanned.
--
-- ── why plain CREATE INDEX and not CONCURRENTLY ─────────────────────────────
-- Not a preference. `db/scripts/db.mjs` wraps EVERY migration file in
-- `begin`/`commit` itself (migrate(): `await db.query('begin')` around
-- `db.query(m.sql)`), so an unwrapped file does not exist as far as the runner
-- is concerned. Proven rather than assumed, against this database:
--
--     begin; create index concurrently … ;
--     ERROR 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--
-- The alternative was to teach the runner to run some files outside a
-- transaction, which trades a partially-applied migration for a lock this
-- data size does not notice: the widest table here is `agent_message` at ~500
-- rows and `workflow`/`connector_connection`/`agent_rule` are in single
-- digits. An honest plain index beats a CONCURRENTLY that never runs. When a
-- table here first reaches a size where the ACCESS EXCLUSIVE lock is felt,
-- the runner is the thing to change, and this comment is the reason why.
--
-- ── what "verified" means for each index below ──────────────────────────────
-- Every one was created in a throw-away transaction and the REAL query from
-- the code path was EXPLAIN ANALYZEd at the altitude it actually runs at:
-- the four sweeps are SECURITY DEFINER bodies, so at owner altitude; the rest
-- as `echo_app` with `echo.actor_id` set, because a plan taken above the wall
-- is a different plan (RLS adds predicates the planner sees). `echo_app` was
-- asserted `rolbypassrls = false` first.
--
-- Two readings per index, because one could not tell them apart:
--   FREE     — what the planner does at today's row counts.
--   PENALISED— the same query with `enable_seqscan = off`.
-- On a database whose biggest table here is ~1,800 rows a seq scan legitimately
-- wins almost everything, so a FREE reading of "not used" is ambiguous between
-- "the table is too small to bother" and "this index can never serve this
-- query". Only the penalised reading answers the second, and three candidates
-- were REFUSED on it — see 0132's sibling note at the bottom.
--
-- ── the ANALYZE at the end ──────────────────────────────────────────────────
-- Statistics on this database were stale enough to be worth more than some of
-- the indexes: `sessions.list` went 1987 → 444 shared buffers on ANALYZE
-- ALONE, with no index involved. That is recorded because it is the sort of
-- thing an index gets undeserved credit for. Sampled, so cheap at any size.

-- ── the trigger match: scanned on EVERY product event ───────────────────────
-- enqueueWorkflowEvents / enqueueConnectorEvent / hasSubscribedWorkflow all
-- ask the same question. FREE: adopted immediately (Seq Scan on workflow →
-- Index Scan using workflow_trigger_idx). The partial predicate is every
-- constant term of the query, so the index holds only rows that can match.
create index workflow_trigger_idx
  on echo.workflow (org_id, trigger_event)
  where enabled and archived_at is null and current_version_id is not null;

-- ── the four timer sweeps ───────────────────────────────────────────────────
-- All four: FREE = seq scan (1–6 live rows; correct). PENALISED = each index
-- adopted by name, with the ordering satisfied from the index rather than a
-- Sort node — which is what proves the shape matches the sweep, not merely
-- that an index exists. The NULLS direction is copied from the sweep's own
-- ORDER BY: `nulls first` for the pollers (never-polled goes first) and
-- `nulls last` for waits. Get that backwards and the index is present,
-- readable, and unusable for the sort.
create index connector_mail_due_idx
  on echo.connector_connection (polled_at asc nulls first)
  where status = 'connected';

create index connector_calendar_due_idx
  on echo.connector_connection (calendar_polled_at asc nulls first)
  where status = 'connected';

create index workflow_run_wait_idx
  on echo.workflow_run (wait_deadline asc nulls last)
  where status = 'waiting';

-- due_agent_rules() filters `event = 'cron.weekly'` and had been reaching it
-- through `agent_rule_one_per_event (owner_id, event)` — a non-leading-column
-- bitmap scan, which Postgres will do on a small index and stops doing as the
-- table grows. `last_fired_at` rides along so the age test is answered from
-- the index instead of a heap filter.
create index agent_rule_due_idx
  on echo.agent_rule (event, last_fired_at)
  where enabled;

-- ── three lists ─────────────────────────────────────────────────────────────
-- sessions.list orders `last_message_at desc nulls last, created_at desc`.
-- `agent_session_actor_idx` already existed and orders by
-- `coalesce(last_message_at, created_at) desc` — a DIFFERENT ordering, so it
-- could serve the actor predicate and never the sort. FREE: adopted, and the
-- Sort node disappears. At eight live sessions that is worth nothing measurable
-- (13.77 → 13.83 ms, inside noise); it is here for the LIMIT that ships with
-- it, where a top-N sort over every session is the thing being avoided.
create index agent_session_recent_idx
  on echo.agent_session (actor_id, last_message_at desc nulls last, created_at desc)
  where archived_at is null;

-- /v1/cards was a seq scan. The existing `agent_card_owner_unread` is partial
-- on `read_at is null`, so it serves half the list and the read half fell
-- through. FREE: adopted, and this one does move at today's size —
-- 157 → 134 shared buffers, 1.27 → 1.02 ms, five reps each, ranges disjoint.
create index agent_card_owner_idx
  on echo.agent_card (owner_id, created_at desc);

-- directory.list matches people to members by folded name. `person` has had
-- `person_org_name_idx (org_id, echo.fa_fold(display_name))` since 0096 and
-- has used it 1,359 times; the other side of the same comparison had nothing.
-- FREE: adopted (app_user_org_idx → app_user_org_name_idx). Worth nothing at
-- nine members and O(people × members) without it.
create index app_user_org_name_idx
  on echo.app_user (org_id, echo.fa_fold(display_name));

analyze echo.workflow;
analyze echo.connector_connection;
analyze echo.workflow_run;
analyze echo.agent_rule;
analyze echo.agent_session;
analyze echo.agent_card;
analyze echo.app_user;
analyze echo.person;

-- ── three that were asked for and are deliberately NOT here ─────────────────
--
-- 1. `agent_run (org_id, started_at desc)`. The planner DOES adopt it, which
--    is exactly why it needed a second question. It displaces
--    `agent_run_org_actor_idx (org_id, actor_id, started_at desc)`, which was
--    already answering the same access. Page 1 of the audit feed cannot tell
--    them apart (no range predicate — every plan reads the whole org
--    partition), so it was measured on PAGE 2, where the keyset cursor is:
--
--      without  12.69 ms / 1597 buffers      with  12.72 ms / 1592 buffers
--
--    and the plan says why. The cursor is a row comparison,
--    `ROW(started_at, 'agent_run', id) < ROW(…)`, which Postgres keeps as a
--    Filter rather than decomposing into an Index Cond on `started_at` — so
--    both indexes scan the org partition and discard the same 120 rows. The
--    outer sort is over a `union all` on `(at, source, id)` and cannot be
--    served by a per-arm index at all. That is a permanent property of the
--    query's shape, not a row-count effect: five buffers, on a table that
--    gains a row per assistant turn, is write amplification for nothing.
--
-- 2. `app_user (created_at desc, id desc)`  and
-- 3. `org (created_at desc, id desc)`.
--    Their only callers are platform.organizations() and platform.users(),
--    and on any deployment past 0091 both read through the console door —
--    `from echo.platform_list_orgs() o … order by o.created_at desc, o.id desc`.
--    A set-returning plpgsql function is an optimisation fence: the plan is
--    `Function Scan → Sort`, and the query never touches `echo.org` or
--    `echo.app_user` at a level where an index on them could apply. Held true
--    with `enable_seqscan = off`, which is the strongest push toward an index
--    available — so this is "can never", not "too small". If those lists ever
--    need an index it will be because the door learned to take the ordering
--    and the paging, and the index would then be written against the door's
--    body, not guessed from the caller's ORDER BY.
