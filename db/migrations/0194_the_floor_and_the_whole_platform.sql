-- 0194 — the floor, and the whole platform for every agent.
--
-- USER, 2026-09-06: "when I ask for Roya or Ava they are supposed to keep
-- talking back until I say someone else's name … like humans do: if you ask
-- for someone they will join and say hello and until you are talking they
-- stand and listen and respond." Ruled the same day: two names in one
-- message → both answer; the floor is released only by a name or the × on
-- the screen. And: "full tool set for all three, yes" — every agent reaches
-- every part of the platform, the person's role being the only wall.
--
-- ── THE FLOOR IS A COLUMN ─────────────────────────────────────────────────
--
-- 0175 gave the thread `current_agent` — who SPOKE last, a fact the log
-- reads. The floor is a different fact: who the person CALLED and has not
-- dismissed, which may be two colleagues at once and may be nobody. It is
-- stored rather than derived from the messages because "Roya answered last"
-- and "Roya was called" come apart the moment Echo is named beside her, and
-- because the × on the screen has to write somewhere the router will read.
-- A text[] with the handle rule 0175 chose, enforced through an IMMUTABLE
-- function — a CHECK cannot hold a subquery, and a trigger for a shape rule
-- is a trigger somebody forgets is there.
--
-- `[]` is Echo. A floor of exactly ['echo'] is the default spelled out, so
-- the api stores it as `[]` — one state, one spelling.

begin;

create or replace function echo.floor_ok(handles text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(array_length(handles, 1), 0) <= 8
     and not exists (
       select 1 from unnest(handles) as h
        where h !~ '^[a-z][a-z0-9_]{1,30}$'
     );
$$;

alter table echo.agent_session
  add column floor text[] not null default '{}'::text[]
    constraint agent_session_floor_handles check (echo.floor_ok(floor));

comment on column echo.agent_session.floor is
  'Who holds the floor (0194): the agent handles the person called into this '
  'conversation and has not dismissed, in the order they were named; each '
  'answers an unaddressed message in turn. {} = Echo, the default. Set by the '
  'router on every turn and by the × on the composer; released only by a '
  'name or that ×.';

-- ── every agent, the whole platform ───────────────────────────────────────
-- The colleagues' stored instructions (db/0163) gain the reach sentence and
-- the floor manners, APPENDED under a sentinel (0180's pattern): nothing is
-- dropped, the file re-runs clean, and 0192's and 0193's paragraphs are
-- asserted to still be there.

update echo.assistant_agent
   set instructions = instructions || E'\n\n'
     || 'دسترسی تو همان دسترسی کاربر است — نه بیشتر و نه کمتر: همهٔ بخش‌های سکو (داشبورد، دستیار، تسک‌ها و پروژه‌ها، جلسه‌ها و رکوردها، اتاق‌های گفت‌وگو، اعضا، عامل‌ها، گردش‌کارها، اتصال‌ها، تنظیمات و مدیریت) با همان ابزارهایی که اکو دارد در اختیار توست، و دیوار، نقش خود کاربر است که پایگاه‌داده نگه می‌دارد. پس هرگز نگو «دسترسی ندارم»؛ اگر سکو کاری را برای نقش او رد کرد، بگو نقش او اجازه نمی‌دهد و چه کسی می‌تواند، و اگر چیزی اصلاً در سکو نیست، همین را بگو. وقتی کسی تو را به نام صدا می‌زند وارد گفت‌وگو می‌شوی — اگر فقط صدایت زده، یک سلام کوتاه کن و بپرس چه می‌خواهد؛ اگر چیزی پرسیده، همان را جواب بده — و تا وقتی نام کس دیگری را نبرده یا گفت‌وگو را به اکو برنگردانده، تو پاسخ می‌دهی؛ لازم نیست هر بار صدایت بزنند و خودت گفت‌وگو را ترک نمی‌کنی.'
 where level = 'system'
   and handle in ('roya', 'ava')
   and position('دسترسی تو همان دسترسی کاربر است' in instructions) = 0;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_missing int;
  v_lost    int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'agent_session'
       and column_name = 'floor' and is_nullable = 'NO'
  ) then
    raise exception 'CHECK FAILED: agent_session.floor missing or nullable';
  end if;

  -- the constraint refuses a value that is not a handle …
  begin
    insert into echo.agent_session (org_id, actor_id, title, context, floor)
    select o.id, u.id, '', '{}'::jsonb, array['NOT A HANDLE']
      from echo.app_user u join echo.org o on o.id = u.org_id limit 1;
    raise exception 'CHECK FAILED: floor accepted a value that is not a handle';
  exception
    when check_violation then null;
    when no_data_found then null;
  end;

  -- … and a ninth name …
  begin
    insert into echo.agent_session (org_id, actor_id, title, context, floor)
    select o.id, u.id, '', '{}'::jsonb, array['a1','a2','a3','a4','a5','a6','a7','a8','a9']
      from echo.app_user u join echo.org o on o.id = u.org_id limit 1;
    raise exception 'CHECK FAILED: floor accepted nine handles';
  exception
    when check_violation then null;
    when no_data_found then null;
  end;

  -- … and ACCEPTS two real ones (a check that refuses everything would pass
  -- both refusals above and break every routed turn)
  begin
    insert into echo.agent_session (org_id, actor_id, title, context, floor)
    select o.id, u.id, '', '{}'::jsonb, array['roya','ava']
      from echo.app_user u join echo.org o on o.id = u.org_id limit 1;
  exception when check_violation then
    raise exception 'CHECK FAILED: floor refused two valid handles';
  end;
  delete from echo.agent_session where floor = array['roya','ava'] and title = '';

  select count(*) into v_missing
    from echo.assistant_agent
   where level = 'system' and handle in ('roya', 'ava')
     and position('دسترسی تو همان دسترسی کاربر است' in instructions) = 0;
  if v_missing > 0 then
    raise exception 'CHECK FAILED: % shipped agent(s) did not get the reach paragraph', v_missing;
  end if;

  select count(*) into v_lost
    from echo.assistant_agent
   where level = 'system' and handle in ('roya', 'ava')
     and (position('حالا می‌توانی روی خود سکو کار کنی' in instructions) = 0
       or position('پوشه با پروژه فرق دارد' in instructions) = 0
       or position('مثل یک همکار حرف بزن' in instructions) = 0);
  if v_lost > 0 then
    raise exception 'CHECK FAILED: % agent(s) lost a paragraph this one was not allowed to touch', v_lost;
  end if;
end $chk$;

commit;
