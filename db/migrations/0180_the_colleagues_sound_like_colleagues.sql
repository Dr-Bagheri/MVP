-- 0180 — رؤیا and آوا sound like colleagues
--
-- User directive, 2026-09-04: "make the agents talk in a little informal way
-- as well, with a friendly attitude, and not sound like a robot all the time."
--
-- Echo's voice lives in a prompt in core/ and was changed there. These two
-- carry their own instructions in this table (db/0163), so the same paragraph
-- has to reach them here or two of the three colleagues keep the old voice —
-- and the one a person notices is whichever one answered.
--
-- ── WHAT IS ADDED, AND WHAT IS NOT ────────────────────────────────────────
--
-- Tone is the one thing a prompt is genuinely for: it cannot come from a tool
-- description and no check can assert it. What it must not become is
-- CHATTINESS — an assistant that opens every answer with a greeting and closes
-- it with an offer is a robot reading a different script, and the padding is
-- what makes it read as one. So the paragraph is about the sentences rather
-- than about adding any, and it says out loud that warmth is not length.
--
-- Every anti-fabrication clause the two already carry is UNTOUCHED. A
-- friendlier voice that guesses is worse than a stiff one that does not, and
-- for رؤیا in particular the reach argument still holds: her output is
-- addressed to other people, so «هرگز نگو کاری انجام شده که هنوز تأیید نشده»
-- outranks any instruction about how to sound while saying it.
--
-- Appended rather than rewritten: the existing text was argued for line by
-- line in 0163, and replacing it wholesale to add a paragraph is how a rule
-- gets dropped by accident.

begin;

update echo.assistant_agent
   set instructions = instructions || E'\n\n'
     || 'مثل یک همکار حرف بزن، نه مثل یک راهنمای کاربر. جمله‌ها کوتاه، کلمه‌ها ساده، لحن گرم — «باشه» و «حتماً» جایی که آدم می‌گوید اشکالی ندارد. کاری را که کرده‌ای با همان کلماتی بگو که آدم بلند می‌گوید. اما پرحرفی نکن: نه سلام و احوال‌پرسی در هر نوبت، نه «امیدوارم کمک‌کننده باشد»، نه پیشنهاد سه کار دیگری که کسی نخواسته. گرم بودن یعنی کوتاه و روشن جواب دادن، نه بیشتر نوشتن. و وقتی کاری از دستت برنمی‌آید، مثل آدم بگو، بدون دو بار عذرخواهی.'
 where level = 'system'
   and handle in ('roya', 'ava')
   and position('مثل یک همکار حرف بزن' in instructions) = 0;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_missing int;
  v_lost    int;
begin
  select count(*) into v_missing
    from echo.assistant_agent
   where level = 'system' and handle in ('roya', 'ava')
     and position('مثل یک همکار حرف بزن' in instructions) = 0;
  if v_missing > 0 then
    raise exception 'CHECK FAILED: % shipped agent(s) did not get the tone paragraph', v_missing;
  end if;

  /*
   * AND NOTHING WAS LOST. Appending is safe only if it really appended — a
   * rewritten `instructions` that happened to contain the new sentence would
   * satisfy the check above while dropping the anti-fabrication clauses that
   * are the reason these prompts were argued over in the first place. Each
   * agent's own load-bearing sentence is named here.
   */
  select count(*) into v_lost
    from echo.assistant_agent
   where level = 'system'
     and (
       (handle = 'roya' and position('هرگز نگو کاری انجام شده' in instructions) = 0)
       or (handle = 'ava' and position('عدد نساز' in instructions) = 0)
     );
  if v_lost > 0 then
    raise exception 'CHECK FAILED: % agent(s) lost a rule the tone change was not allowed to touch', v_lost;
  end if;
end $chk$;

commit;
