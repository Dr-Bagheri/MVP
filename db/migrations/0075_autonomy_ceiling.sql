-- NeurAI Platform — 0075: the org's autonomy ceiling (M36 completed;
-- AI-native plan Phase C, user-directed 2026-08-21).
--
-- An organization may CAP its members' dial: a member's effective autonomy
-- is min(their choice, the org ceiling). Default 'act' = no cap — the dial
-- stays each person's until an admin deliberately narrows it, and narrowing
-- is org configuration (admins already own org settings; no new door).
--
-- Act in this phase governs CLIENT tools only (a write-effect surface
-- action runs without the consent card). Server-side proposals keep the
-- propose→approve path at every setting — auto-applying those is a
-- separate, later decision with its own allow-list (recorded in the plan;
-- deliberately NOT smuggled in here).

alter table echo.org
  add column autonomy_ceiling text not null default 'act'
    check (autonomy_ceiling in ('watch', 'assist', 'act'));

comment on column echo.org.autonomy_ceiling is
  'M36: members'' effective autonomy = least(app_user.autonomy, this). Default act = no cap.';
