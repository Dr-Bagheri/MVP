-- Echo — 0042: take the padding back off the backfilled handles.
--
-- 0039 guaranteed the three-character minimum by appending '___' to every
-- derived handle instead of only to the short ones, so everybody came out as
-- @devadmin___ rather than @devadmin. The constraint was satisfied and the
-- result was wrong — a handle is a thing people read and type, and one that
-- ends in three underscores announces that a migration wrote it.
--
-- 0039 is applied and checksummed, so the fix is this file rather than an
-- edit. On a fresh database the pair composes: 0039 derives, 0042 tidies, and
-- the end state is the same either way.
--
-- Trimming only where it is safe: the result must still satisfy the format,
-- must not collide with an existing handle in that org, and must not collide
-- with another handle being trimmed in the same statement.

with trimmed as (
  select
    u.id,
    u.org_id,
    regexp_replace(u.username, '_+$', '') as candidate
  from echo.app_user u
  where u.username is not null
    and u.username ~ '_$'
),
counted as (
  select t.*, count(*) over (partition by t.org_id, t.candidate) as same_candidate
  from trimmed t
),
safe as (
  select c.id, c.candidate
  from counted c
  where c.candidate ~ '^[a-z][a-z0-9_]{2,31}$'
    -- unique among the rows being trimmed
    and c.same_candidate = 1
    -- and not already worn by someone in the same org
    and not exists (
      select 1
      from echo.app_user other
      where other.org_id = c.org_id
        and other.username = c.candidate
        and other.id <> c.id
    )
)
update echo.app_user u
   set username = s.candidate
  from safe s
 where s.id = u.id;
