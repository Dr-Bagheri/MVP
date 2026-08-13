-- Echo — 0035: add the 'owner' label to echo.member_role. Nothing else.
--
-- M23 revokes SPEC's two-role rule: owner is the org's root, admins manage
-- members, and the owner manages admins.
--
-- This migration is deliberately one line, and must stay that way. Postgres
-- will not let a newly added enum label be USED in the same transaction that
-- adds it — the backfill, the constraint and the policy changes all reference
-- 'owner', so they cannot share a transaction with this statement. Each
-- migration here runs in its own transaction, so the split is the mechanism:
-- 0035 makes the label exist, 0036 uses it.
--
-- If someone later merges these two files to tidy up, the merged migration
-- fails on a fresh database and succeeds on this one (where the label already
-- exists) — which is the worst kind of green.

alter type echo.member_role add value 'owner';
