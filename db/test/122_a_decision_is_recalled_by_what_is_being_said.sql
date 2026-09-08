-- db/0214 — the ledger's index, and the rule live recall reads it with.
--
-- Item 7's whole behaviour is one sentence: **a decision surfaces when it
-- shares at least two distinctive words with what is being said right now.**
-- The TypeScript half of that rule (which words are distinctive) has its own
-- tests; this file asserts the half only a database can answer — that the
-- index matches through the Persian fold, that the two-word floor actually
-- excludes a one-word coincidence, and that a meeting cannot recall itself.
--
-- The last one is the reason the feature is not an echo, and it is a `where`
-- clause, which is exactly the kind of thing that survives a refactor as a
-- comment and disappears as a predicate.
--
--   alice  owner,  org A   01…01
--   bob    member, org A   02…02
--   erin   owner,  org B   05…05
--
-- Everything here is fixture data in the fixture orgs. Nothing reads the
-- organisation's real decisions — a query written against live data is how a
-- test comes to depend on somebody else's afternoon.

reset role;

-- ── two past meetings and one happening now ───────────────────────────────
insert into echo.meeting (id, org_id, title, scheduled_at, created_by, mode)
values ('14000000-0000-4000-8000-0000000009e1'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ مرداد', now() - interval '30 days',
        '02000000-0000-4000-8000-000000000002', 'in_person'),
       ('14000000-0000-4000-8000-0000000009e2'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ امروز', now(),
        '02000000-0000-4000-8000-000000000002', 'in_person'),
       ('14000000-0000-4000-8000-0000000009e3'::uuid,
        '0b000000-0000-4000-8000-00000000000b',
        'another org', now() - interval '10 days',
        '05000000-0000-4000-8000-000000000005', 'in_person');

insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
values
  -- the one that should surface
  ('15000000-0000-4000-8000-0000000009f1'::uuid,
   '14000000-0000-4000-8000-0000000009e1', '0a000000-0000-4000-8000-00000000000a',
   'decision', 'قرارداد با شرکت الف تا پایان شهریور امضا می‌شود', 'user',
   '02000000-0000-4000-8000-000000000002'),
  -- a decision that shares exactly ONE distinctive word with the window below
  ('15000000-0000-4000-8000-0000000009f2'::uuid,
   '14000000-0000-4000-8000-0000000009e1', '0a000000-0000-4000-8000-00000000000a',
   'decision', 'بودجهٔ تبلیغات برای شهریور دو برابر می‌شود', 'user',
   '02000000-0000-4000-8000-000000000002'),
  -- a decision made in the meeting that is HAPPENING NOW
  ('15000000-0000-4000-8000-0000000009f3'::uuid,
   '14000000-0000-4000-8000-0000000009e2', '0a000000-0000-4000-8000-00000000000a',
   'decision', 'قرارداد شرکت الف را همین امروز بررسی می‌کنیم', 'user',
   '02000000-0000-4000-8000-000000000002'),
  -- another organisation's decision, same words
  ('15000000-0000-4000-8000-0000000009f4'::uuid,
   '14000000-0000-4000-8000-0000000009e3', '0b000000-0000-4000-8000-00000000000b',
   'decision', 'قرارداد شرکت الف امضا شد', 'user',
   '05000000-0000-4000-8000-000000000005');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0214 tests run under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- ── THE RULE, as the query runs it ────────────────────────────────────────
--
-- The window is what the room is saying; the terms are what core/'s
-- `distinctiveTerms` would hand the query for it. They are written out here
-- rather than derived, because this file's subject is the DATABASE half: if
-- the two ever disagree, the TypeScript tests catch that and this one keeps
-- answering the question it was written for.

create temporary view recalled as
with terms as (select unnest(array['قرارداد','شرکت','شهریور','امضا']) as w),
     q as (select to_tsquery('simple',
            string_agg(quote_literal(w) || ':*', ' | ')) as tsq from terms)
select i.id, i.body, i.meeting_id,
       (select count(*) from terms t
         where i.search @@ plainto_tsquery('simple', t.w)) as shared
  from echo.meeting_item i
  join echo.meeting m on m.id = i.meeting_id
 cross join q
 where i.meeting_id <> '14000000-0000-4000-8000-0000000009e2'::uuid
   and i.kind in ('decision', 'action')
   and i.search @@ q.tsq
   and (select count(*) from terms t
         where i.search @@ plainto_tsquery('simple', t.w)) >= 2;

select t.ok(
  (select count(*) = 1 from recalled),
  '0214: exactly one past decision is recalled by what is being said');

select t.ok(
  (select id = '15000000-0000-4000-8000-0000000009f1' from recalled),
  '0214: and it is the one about the contract — the accept half');

-- ── THE ONE-WORD COINCIDENCE IS NOT A TOPIC ───────────────────────────────
--
-- «بودجهٔ تبلیغات برای شهریور» shares «شهریور» and nothing else. It is a real
-- row, it matches the OR query, and the floor is the only thing keeping it
-- off the host's screen — which is why it is asserted rather than assumed.
select t.ok(
  (select count(*) = 0 from recalled
    where id = '15000000-0000-4000-8000-0000000009f2'),
  '0214: a decision sharing ONE word does not surface');
select t.ok(
  (select count(*) = 1 from echo.meeting_item
    where id = '15000000-0000-4000-8000-0000000009f2'
      and search @@ plainto_tsquery('simple', 'شهریور')),
  '0214: ...and the control — it really does share that one word');

-- ── A MEETING DOES NOT RECALL ITSELF ──────────────────────────────────────
--
-- The row in the live meeting shares THREE of the terms, so it would be the
-- top hit; the exclusion is the whole difference between a second brain and
-- an echo.
select t.ok(
  (select count(*) = 0 from recalled
    where meeting_id = '14000000-0000-4000-8000-0000000009e2'),
  '0214: the meeting in progress is not recalled');
select t.ok(
  (select count(*) >= 2 from echo.meeting_item i, unnest(array['قرارداد','شرکت','الف']) w
    where i.id = '15000000-0000-4000-8000-0000000009f3'
      and i.search @@ plainto_tsquery('simple', w)),
  '0214: ...and the control — it would otherwise have been the loudest hit');

-- ── ANOTHER ORGANISATION IS NOT REACHABLE, INDEX OR NO INDEX ──────────────
--
-- The index is a new door onto the ledger, and a new door is where a wall
-- stops being true. Org B's row carries the same words on purpose.
select t.ok(
  (select count(*) = 0 from recalled
    where id = '15000000-0000-4000-8000-0000000009f4'),
  '0214: a full-text index does not reach across the org wall');

-- ── THE FOLD IS THE DATABASE'S ────────────────────────────────────────────
--
-- «شركت» with an Arabic kaf, «مي‌شود» with an Arabic yeh: the spellings a
-- different keyboard produces. Without the fold on both sides these miss
-- SILENTLY, which reads as "recall is just not very good".
select t.ok(
  (select count(*) = 1 from echo.meeting_item
    where id = '15000000-0000-4000-8000-0000000009f1'
      and search @@ websearch_to_tsquery('simple', echo.fa_fold('شركت الف'))),
  '0214: an Arabic-keyboard spelling matches the same row');
select t.ok(
  (select count(*) = 0 from echo.meeting_item
    where id = '15000000-0000-4000-8000-0000000009f1'
      and search @@ websearch_to_tsquery('simple', echo.fa_fold('بودجه تبلیغات'))),
  '0214: and an unrelated query still misses it');

-- ── THE COLUMN CANNOT BE WRITTEN ──────────────────────────────────────────
--
-- A tsvector somebody can set is a second spelling of the body, and the two
-- disagree the first time a row is edited.
select t.raises(
  $$update echo.meeting_item set search = to_tsvector('simple', 'anything')
     where id = '15000000-0000-4000-8000-0000000009f1'$$,
  '428C9', '0214: the search column is generated and refuses a write');

-- ── the fixture leaves nothing behind ─────────────────────────────────────
reset role;
delete from echo.meeting_item where meeting_id in (
  '14000000-0000-4000-8000-0000000009e1',
  '14000000-0000-4000-8000-0000000009e2',
  '14000000-0000-4000-8000-0000000009e3');
delete from echo.meeting where id in (
  '14000000-0000-4000-8000-0000000009e1',
  '14000000-0000-4000-8000-0000000009e2',
  '14000000-0000-4000-8000-0000000009e3');
