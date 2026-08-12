-- Echo — 0025: a per-skill tool-call ceiling (M4 amendment).
--
-- Part of what an admin configures, for the same reason as the model
-- allow-list (M5): a heavy research skill and a two-call recap deserve
-- different budgets, and the admin is the cost lever.
--
-- NULL means "use the runtime default" rather than "unlimited" — the runtime
-- has always had its own ceiling, and a skill that says nothing should inherit
-- it rather than escape it.

alter table echo.skill
  add column max_tool_calls integer;

alter table echo.skill
  add constraint skill_max_tool_calls_positive
  check (max_tool_calls is null or max_tool_calls > 0);

comment on column echo.skill.max_tool_calls is
  'Per-skill tool-call ceiling (M4 amendment). NULL inherits the runtime default; zero is not a way to express "no tools" — an empty tools array is.';
