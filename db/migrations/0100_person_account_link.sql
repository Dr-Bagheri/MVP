-- 0100 — one directory person per platform account.
--
-- `echo.person.app_user_id` has existed since 0005, with the composite FK
-- (app_user_id, org_id) -> app_user (id, org_id) that makes a cross-org link
-- structurally unrepresentable. The wall already permits writing it: 0013's
-- person_update policy has no column predicate and 0014 grants table-level
-- UPDATE. What never existed is a WRITER — the column has been served as
-- null to every client for the life of the product (the register_account
-- shape, a fourth time). The api gains that writer today (user directive,
-- 2026-08-26: "identify by user account"), which is what makes this index
-- worth cutting now rather than later.
--
-- The rule: an ACTIVE directory row may claim an account only if no other
-- active row already claims it. Without it the duplicate that Merge exists
-- to fix becomes representable at the account level, and "which of these two
-- rows is this member?" has two true answers — the exact ambiguity that
-- would later drive voiceprint matching and "who was in this meeting".
-- Structure rather than a predicate, per the house preference: the wrong
-- state cannot be written, instead of being checked for in every caller.
--
-- Deliberately partial on `merged_into is null`: a merged (tombstoned) row
-- keeps whatever link it had and falls OUT of the index, so echo.merge_person
-- is untouched by this migration and cannot start raising 23505 inside a
-- definer door. The price, recorded: a merge does not transfer the link, so
-- a winner with no link stays unlinked. That is a one-press repair on a
-- surface the admin is already standing on, and merge is leaving the UI in
-- the same directive — if it ever returns, THAT is the moment to decide
-- whether the winner should inherit (the voiceprint's rule in 0098 is the
-- pattern to copy).

begin;

create unique index person_one_per_member
  on echo.person (org_id, app_user_id)
  where app_user_id is not null and merged_into is null;

comment on column echo.person.app_user_id is
  'the platform account this directory person IS, when they are a member; null = not a member (an outsider on the other end of a call), or simply not identified yet. Unique among ACTIVE rows per org (person_one_per_member).';

commit;
