-- Echo — 0086: TAGS on records (user backlog item, built 2026-08-23:
-- "tags/labels on records + filter chips — organize by project or client").
--
-- One text[] column on the call, not a join table: a tag is a label the
-- record wears, not an entity with its own lifecycle — nothing references
-- a tag, nothing cascades from one, and the filter is an array-contains
-- over a GIN index. If tags ever grow behavior (colors, permissions,
-- rename-everywhere), THAT is the moment they become a table.
--
-- WHO may tag is already decided: the 0077 guard runs one rule for every
-- column of echo.call — your own record, or one whose owner your role
-- strictly outranks — so tags inherit the hierarchy with no new policy.
-- This migration only has to say what a WELL-FORMED set of tags is.

alter table echo.call add column tags text[] not null default '{}';

comment on column echo.call.tags is
  'Labels the record wears (0086): at most 10, each 1–40 chars, trimmed, no duplicates — shape enforced by tg_call_tags_shape. Who may write them is the 0077 hierarchy, same as every call column.';

-- the cardinality bound lives in a constraint (cheap, indexable truth);
-- per-element shape needs unnest, so it lives in the trigger below
alter table echo.call add constraint call_tags_bounded
  check (coalesce(array_length(tags, 1), 0) <= 10);

create index call_tags_idx on echo.call using gin (tags);

-- ---------------------------------------------------------------------------
-- Element shape: trimmed, non-empty, bounded, distinct. A BEFORE trigger
-- rather than an api-side mirror alone — the wall must hold for every
-- caller, including ones that do not exist yet.
-- ---------------------------------------------------------------------------

create function echo.tg_call_tags_shape() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.tags is distinct from old.tags or tg_op = 'INSERT' then
    if exists (
      select 1 from unnest(new.tags) as t
      where t is null or btrim(t) = '' or t is distinct from btrim(t) or length(t) > 40
    ) then
      raise exception 'each tag must be trimmed, non-empty and at most 40 characters'
        using errcode = 'check_violation';
    end if;
    if (select count(distinct t) from unnest(new.tags) as t)
       <> coalesce(array_length(new.tags, 1), 0) then
      raise exception 'tags must be distinct' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger call_tags_shape
  before insert or update on echo.call
  for each row execute function echo.tg_call_tags_shape();
