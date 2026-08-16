-- Echo — 0059: skills gain starter questions (M29, Part 2).
--
-- The one column the Onyx-persona mapping found genuinely missing: a skill
-- can suggest how to begin (rendered as chips on the hub when the skill is
-- active). Everything else M29 assumed absent already existed — level with
-- its shape constraint (0007), write policies per level (0013), the
-- archive-not-delete ruling and slug freeing (0018), max_tool_calls (0025).
-- A column-level gap, not a feature-level one, which is the good version.
--
-- jsonb array of strings, same discipline as `tools`: the typeof CHECK is
-- the wall's half (an object can never land), and core filters elements to
-- strings so one malformed entry costs one chip, never the skill.

alter table echo.skill
  add column starter_questions jsonb not null default '[]';

alter table echo.skill
  add constraint skill_starter_questions_is_array
  check (jsonb_typeof(starter_questions) = 'array');

comment on column echo.skill.starter_questions is
  'Suggested opening questions (M29), rendered as hub chips. Array of strings; elements filtered at the api.';
