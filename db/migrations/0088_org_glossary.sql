-- Echo — 0088: the org GLOSSARY (quality pass, 2026-08-23).
--
-- Names and terms the organisation records once so the transcriber can be
-- biased toward them on every call — Persian proper names are where the
-- errors concentrate, and «محمد رضایی» spelled right in one place fixes it
-- in every transcript that follows. The worker reads this at process time
-- and hands it to the STT lane as recognition context; it never gates a
-- transcription.
--
-- A column on org, not a table: a glossary term is a string the org wears,
-- exactly the 0086 reasoning — the moment terms grow behavior (per-person
-- pronunciations, auto-learning from corrections), THAT is the table.
-- WHO may edit: org fields are already the admins' (org_admin_update);
-- this column simply joins them.

alter table echo.org add column glossary text[] not null default '{}';

comment on column echo.org.glossary is
  'Recognition-context terms for the transcriber (0088): at most 200, each 1-60 chars, trimmed, distinct — shape enforced by tg_org_glossary_shape. Advisory bias, never a gate.';

alter table echo.org add constraint org_glossary_bounded
  check (coalesce(array_length(glossary, 1), 0) <= 200);

create function echo.tg_org_glossary_shape() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.glossary is distinct from old.glossary or tg_op = 'INSERT' then
    if exists (
      select 1 from unnest(new.glossary) as t
      where t is null or btrim(t) = '' or t is distinct from btrim(t) or length(t) > 60
    ) then
      raise exception 'each glossary term must be trimmed, non-empty and at most 60 characters'
        using errcode = 'check_violation';
    end if;
    if (select count(distinct t) from unnest(new.glossary) as t)
       <> coalesce(array_length(new.glossary, 1), 0) then
      raise exception 'glossary terms must be distinct' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger org_glossary_shape
  before insert or update on echo.org
  for each row execute function echo.tg_org_glossary_shape();
