-- 0192 — the colleagues get their hands.
--
-- USER DIRECTIVE, 2026-09-05: "if the number of tasks given to Echo goes more
-- than 3, or if the user asks him to use agents for the work, it must call
-- them and ask them to do the job; also give all of them — Echo, Ava, Roya —
-- full control over the updates we have in the platform, like create
-- projects or delete them or edit them, build folders in tasks, give
-- projects and tasks to someone, move them — all a human can do."
--
-- The hands themselves are CLIENT tools (core/src/agent/client-tools.ts):
-- they run in the person's own browser, on the person's own session, behind
-- a consent card below Act — so this migration touches no grant and no
-- policy. echo_agent still holds no DELETE anywhere; the delete an agent
-- proposes is the PERSON's delete, pressed on their yes.
--
-- What a migration IS for here: the two shipped colleagues carry their own
-- instructions in this table (db/0163), and those instructions still say
-- «به‌جای انجام کار» (Ava) and describe a world where every change is only a
-- proposal. A paragraph is APPENDED (0180's pattern — appending is how a
-- rule is added without one being dropped by accident), guarded by its own
-- sentinel so the file re-runs clean, and the descriptions — the sentence
-- under each name on the agents page — are brought up to date.

begin;

update echo.assistant_agent
   set instructions = instructions || E'\n\n'
     || 'حالا می‌توانی روی خود سکو کار کنی، نه فقط پاسخ بدهی: پروژه بساز و ویرایش و بایگانی کن، پوشه و ستون و برچسب بساز، تسک بساز و واگذار و جابه‌جا کن، جلسه و اتاق گفت‌وگو بساز. هر تغییری اول به کاربر نشان داده می‌شود و تا تأیید نکند اعمال نمی‌شود — پس هرگز نگو کاری انجام شده که هنوز تأیید نشده. وقتی اکو کاری به تو می‌سپارد، همان را با ابزارهایت انجام بده، و در پایان دقیق بگو چه کردی، چه چیزی منتظر تأیید است و چه چیزی نشد.'
 where level = 'system'
   and handle in ('roya', 'ava')
   and position('حالا می‌توانی روی خود سکو کار کنی' in instructions) = 0;

update echo.assistant_agent
   set description = 'کارها را انجام می‌دهد: تسک و پروژه می‌سازد و واگذار می‌کند، جلسه را آماده می‌کند، پاسخ می‌نویسد.'
 where level = 'system' and handle = 'roya';

update echo.assistant_agent
   set description = 'می‌خواند و گزارش می‌دهد: چه تغییر کرده، چه عقب افتاده، هفته چه گفت — و یافته‌ها را، اگر بخواهی، به کار تبدیل می‌کند.'
 where level = 'system' and handle = 'ava';

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_missing int;
  v_lost    int;
  v_desc    int;
begin
  select count(*) into v_missing
    from echo.assistant_agent
   where level = 'system' and handle in ('roya', 'ava')
     and position('حالا می‌توانی روی خود سکو کار کنی' in instructions) = 0;
  if v_missing > 0 then
    raise exception 'CHECK FAILED: % shipped agent(s) did not get the hands paragraph', v_missing;
  end if;

  /* AND NOTHING WAS LOST (0180's rule): each agent's own load-bearing
     sentence, and the tone paragraph 0180 appended, must still be there —
     a rewritten prompt that happened to contain the new sentence would
     pass the check above while dropping the rules these prompts exist for. */
  select count(*) into v_lost
    from echo.assistant_agent
   where level = 'system'
     and (
       (handle = 'roya' and position('هرگز نگو کاری انجام شده' in instructions) = 0)
       or (handle = 'ava' and position('عدد نساز' in instructions) = 0)
       or (handle in ('roya', 'ava') and position('مثل یک همکار حرف بزن' in instructions) = 0)
     );
  if v_lost > 0 then
    raise exception 'CHECK FAILED: % agent(s) lost a rule the hands were not allowed to touch', v_lost;
  end if;

  select count(*) into v_desc
    from echo.assistant_agent
   where level = 'system'
     and ((handle = 'roya' and position('پروژه' in description) = 0)
       or (handle = 'ava' and position('به کار تبدیل' in description) = 0));
  if v_desc > 0 then
    raise exception 'CHECK FAILED: % agent description(s) still describe the old reach', v_desc;
  end if;
end $chk$;

commit;
