-- 0214 — the ledger becomes searchable, so a past decision can surface while
-- the meeting is still happening.
--
-- Item 7 of the twenty: mid-sentence, a card appears on the host's stage —
-- «this was decided on 24 Mordad» — and nobody is interrupted. The corpus is
-- 0211's `meeting_item`: what was decided, who owes it, and whether it still
-- stands. What it lacked was an index; a `like` scan over every decision, once
-- every few seconds, in a meeting, is not a feature.
--
-- ── WHY THE FOLD IS THE DATABASE'S ────────────────────────────────────────
--
-- 0006's exact shape, and its reason holds here unchanged: the fold is applied
-- by the GENERATED column so the index and the query cannot drift apart. A
-- query folded in TypeScript against an index built from raw text fails to
-- match Persian variants (ي/ی, ك/ک, ZWNJ) — and it fails SILENTLY, which
-- reads as "recall just does not work very well" rather than as an error.
--
-- ── WHAT THIS DOES NOT ADD ────────────────────────────────────────────────
--
-- No new table, no new policy, no new grant. A decision is already readable by
-- exactly the people who can read its meeting (0160, 0211), and recall must
-- not widen that by one row: the card appears on the host's screen because the
-- host asked, under the host's own identity, through the same policy the
-- ledger panel reads through. There is nothing here to get wrong later,
-- because there is nothing here.

begin;

alter table echo.meeting_item
  add column search tsvector generated always as
    (to_tsvector('simple', echo.fa_fold(body))) stored;

comment on column echo.meeting_item.search is
  '0214: the decision''s own words, folded by the database so a query cannot drift from the index (0006''s rule). Read by live recall during a meeting and by nothing else yet.';

/* GIN, like every other search index here. A decision ledger is small next to
   a transcript, but the query runs on a timer during a live meeting, which is
   the one place a sequential scan is felt rather than measured. */
create index meeting_item_search_idx on echo.meeting_item using gin (search);

/* The org filter is what every recall query starts with, and the planner
   should reach the right rows before it ranks them. */
create index meeting_item_org_kind_idx on echo.meeting_item (org_id, kind);

-- ── self-checks ───────────────────────────────────────────────────────────
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_meet uuid;
  v_id   uuid;
  v_hits int;
begin
  -- 1. THE COLUMN IS GENERATED, not writable. A tsvector somebody can set is
  --    a second spelling of the body, and the two would disagree the first
  --    time a row was edited.
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'echo.meeting_item'::regclass
       and attname = 'search' and attgenerated = 's'
  ) then
    raise exception '0214: meeting_item.search is not a stored generated column';
  end if;

  -- 2. IT ACTUALLY MATCHES, through the fold. The accept half — every
  --    structural assertion above is satisfied by a column that indexes
  --    nothing, and this is a feature whose whole value is a hit.
  select id into v_org from echo.org order by created_at limit 1;
  select id into v_user from echo.app_user where org_id = v_org and status = 'active' limit 1;
  if v_org is not null and v_user is not null then
    insert into echo.meeting (id, org_id, title, scheduled_at, created_by, mode)
    values (gen_random_uuid(), v_org, 'selfcheck 0214', now(), v_user, 'in_person')
    returning id into v_meet;

    insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values (v_meet, v_org, 'decision',
            'قرارداد با شرکت الف تا پایان شهریور امضا می‌شود', 'user', v_user)
    returning id into v_id;

    /* the SAME sentence typed with an Arabic yeh and no ZWNJ — the spelling a
       different keyboard produces. Without the fold on both sides this misses,
       which is the silent failure this column exists to make impossible. */
    select count(*) into v_hits from echo.meeting_item
     where id = v_id
       and search @@ websearch_to_tsquery('simple', echo.fa_fold('قرارداد شركت الف'));
    if v_hits <> 1 then
      raise exception '0214: the folded query did not match its own folded row';
    end if;

    /* and the DISCRIMINATING half: an unrelated sentence must not match, or
       the assertion above is true of an index that matches everything */
    select count(*) into v_hits from echo.meeting_item
     where id = v_id
       and search @@ websearch_to_tsquery('simple', echo.fa_fold('بودجهٔ تبلیغات'));
    if v_hits <> 0 then
      raise exception '0214: an unrelated query matched — the index is not discriminating';
    end if;

    delete from echo.meeting_item where id = v_id;
    delete from echo.meeting where id = v_meet;
  end if;
end $check$;

commit;
