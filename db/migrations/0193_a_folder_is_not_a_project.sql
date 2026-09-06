-- 0193 — a folder is not a project.
--
-- USER, 2026-09-06: "they also still don't understand the difference between
-- folder and projects: a folder is for you to sum up in a different place
-- your own tasks that you made for yourself, but projects are next to it and
-- added by admins for you. When I asked them to create projects they must go
-- there and make it and add tasks with the person that has to do it in it.
-- Give them the access and the understanding."
--
-- The ACCESS is code: `list_projects` and the board's `folders` in
-- `list_tasks` (platform-tools.ts), and `create_task` filing by `project` or
-- `folder` with the person in the same create (client-tools.ts, the web
-- surface). The UNDERSTANDING for the two shipped colleagues lives in this
-- table (db/0163): their instructions get the sentence, APPENDED under its
-- own sentinel (0180's pattern — nothing dropped by accident, re-runs clean),
-- and 0192's paragraph is asserted to still be there.

begin;

update echo.assistant_agent
   set instructions = instructions || E'\n\n'
     || 'پوشه با پروژه فرق دارد: پوشه دسته‌بندی شخصی تسک‌های خود آدم روی برد است و کسی به آن واگذار نمی‌شود؛ پروژه دستورِ کارِ مدیر است با آدم‌هایش و صفحه‌ای برای خودش، و پوشه‌ای به همان نام روی برد دارد که پیشرفتش از تسک‌های داخل آن شمرده می‌شود. وقتی پروژه خواستند — «پروژه بساز» — اول با create_project بسازش و بعد کارهایش را داخل همان پروژه بگذار: برای هر کار یک create_task با project=نام پروژه و assignee=کسی که باید انجامش دهد. هرگز به‌جای پروژه پوشهٔ خالی نساز. وقتی پوشه خواستند، create_task_topic. پیش از هر ثبتی list_projects و پوشه‌های list_tasks را بخوان تا بدانی کدام کدام است.'
 where level = 'system'
   and handle in ('roya', 'ava')
   and position('پوشه با پروژه فرق دارد' in instructions) = 0;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_missing int;
  v_lost    int;
begin
  select count(*) into v_missing
    from echo.assistant_agent
   where level = 'system' and handle in ('roya', 'ava')
     and position('پوشه با پروژه فرق دارد' in instructions) = 0;
  if v_missing > 0 then
    raise exception 'CHECK FAILED: % shipped agent(s) did not get the folder-vs-project paragraph', v_missing;
  end if;

  /* AND NOTHING WAS LOST (0180's rule): 0192's hands paragraph, each agent's
     own load-bearing sentence, and 0180's tone paragraph must all still be
     there — a rewritten prompt that happened to contain the new sentence
     would pass the check above while dropping the rules these exist for. */
  select count(*) into v_lost
    from echo.assistant_agent
   where level = 'system'
     and (
       (handle in ('roya', 'ava') and position('حالا می‌توانی روی خود سکو کار کنی' in instructions) = 0)
       or (handle = 'roya' and position('هرگز نگو کاری انجام شده' in instructions) = 0)
       or (handle = 'ava' and position('عدد نساز' in instructions) = 0)
       or (handle in ('roya', 'ava') and position('مثل یک همکار حرف بزن' in instructions) = 0)
     );
  if v_lost > 0 then
    raise exception 'CHECK FAILED: % agent(s) lost a rule this paragraph was not allowed to touch', v_lost;
  end if;
end $chk$;

commit;
