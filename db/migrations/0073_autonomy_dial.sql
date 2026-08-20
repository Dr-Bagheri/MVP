-- NeurAI Platform — 0073: the autonomy dial (proposed M36; AI-native plan
-- Phase A, user-directed 2026-08-21).
--
-- Per-user agent autonomy: how much the assistant may DO without asking.
--   watch  — the agent reads and briefs; surface controls and writes refused
--   assist — surface (ui) actions run; write-class actions need consent
--   act    — org-approved write classes auto-apply (behavior ships Phase C;
--            the value is legal now so a stored choice never round-trips
--            through an error when C lands)
--
-- A COLUMN, not a policy: the dial widens/narrows what the runtime offers
-- and what the surface auto-performs. The grant wall never moves — echo_app
-- and echo_agent keep exactly the privileges they had (M4's rule restated
-- at the dial: approval widens content, never the grant).
--
-- core detects this column at boot (capability detection) and degrades to
-- 'assist' with a loud log line until the migration lands — deployments and
-- migrations may arrive in either order.

alter table echo.app_user
  add column autonomy text not null default 'assist'
    check (autonomy in ('watch', 'assist', 'act'));

comment on column echo.app_user.autonomy is
  'M36 autonomy dial: watch | assist | act. Read fresh per ask; org ceiling arrives with Act (Phase C).';
