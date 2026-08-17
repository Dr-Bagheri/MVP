-- Echo — 0062: people get a TITLE (user directive, 2026-08-17: "a section
-- for speakers and their title, like CEO, CTO, COO, CMO and so on until
-- employee").
--
-- A closed vocabulary enforced by a CHECK, not by whoever remembers the
-- list: the constraint is the enforcer, the api mirrors it, and the 23514
-- backstop re-speaks the same sentence (the username pattern, D-family).
-- Codes, not display strings — the UI localizes; «مدیرعامل» and "CEO" are
-- the same fact.
--
-- '' is "no title chosen", a real state and the default: a person added in
-- a hurry is not thereby an employee.

alter table echo.person
  add column title text not null default '';

alter table echo.person
  add constraint person_title_known check (title in (
    '', 'ceo', 'cto', 'coo', 'cmo', 'cfo',
    'vp', 'director', 'manager', 'lead', 'employee', 'other'
  ));

comment on column echo.person.title is
  'Org-chart title code from a closed set (0062). Empty = not chosen. The UI localizes the code; the constraint is the enforcer.';
