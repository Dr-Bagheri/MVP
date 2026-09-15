-- 0222 — the summarizer's own prompt stops being a signal about the answer's
-- language.
--
-- 0219 corrected what this prompt SAYS: it used to promise «خروجی همیشه فارسی
-- است» and now says the summary follows the language of the meeting. That was
-- necessary and it was not sufficient, and the evidence is four recordings.
--
-- ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
--
-- An English organisation, an English recording, an English transcript, and a
-- Persian summary — four times running, with a different fix in place each
-- time:
--
--   1. this row corrected (0219)                          → Persian
--   2. …plus a language rule riding every run             → Persian
--   3. …plus the rule restated after the transcript, and
--      a bilingual closing instruction                    → Persian
--   4. …plus the WHOLE scaffold composed in English
--      (core's scaffoldLanguage, same day)                → Persian, but the
--      owner markers came back as «owner:» rather than «مسئول:»
--
-- The fourth run is the one that names the cause. The scaffold was English and
-- the model half-followed it — so it was reading the English, and something
-- else was outweighing it. That something is THIS ROW: the skill's prompt is
-- the SYSTEM message, it arrives before everything else, and it is written
-- entirely in Persian. A model answers the language it is addressed in, and the
-- first voice that addresses it is this one.
--
-- ── THE CHANGE ────────────────────────────────────────────────────────────
--
-- The prompt says the same four things it said before — search prior calls,
-- write from the transcript, follow the meeting's language, never write what is
-- not there — in BOTH languages, with the language rule first.
--
-- Bilingual rather than switched at run time, and that is the constraining
-- choice. A prompt selected by language would need something to select it BY,
-- and the only candidates are `call.language` (detected, one value, wrong for a
-- meeting held in two) or a second skill row per language (two prompts to keep
-- in step, which is the two-spellings defect this codebase has paid for
-- repeatedly). A prompt that addresses the model in both languages pushes it
-- toward neither, and leaves the decision where 0219 put it: the transcript.
--
-- It also survives the case a language-switched prompt cannot: an org that
-- edits its own summarizer skill gets ONE row to edit, not one per language.
--
-- Everything else is unchanged — the tools, the search-first instruction and
-- the anti-fabrication floor are the behaviour we want and are asserted below.
-- `where level = 'system'` touches exactly the row 0015 inserted and never an
-- organisation's own override (M4: a skill an org has edited is that org's).

begin;

update echo.skill
   set prompt =
         -- The language rule FIRST, in both languages, because the first line
         -- of a system prompt is the strongest signal in it.
         'زبان خلاصه همان زبان جلسه است: متن پیاده‌شدهٔ انگلیسی → خلاصهٔ انگلیسی؛ '
      || 'متن فارسی → خلاصهٔ فارسی. زبان خودت را بر جلسه تحمیل نکن. '
      || '(The summary is written in the language of the meeting: an English '
      || 'transcript gets an English summary, a Persian transcript a Persian one. '
      || 'Never translate the meeting into a language nobody in it spoke.) '
      || 'شما خلاصه‌ساز گفتگوهای کاری هستید. قبل از نوشتن، با ابزارهای جست‌وجو '
      || 'تماس‌های پیشین با همان افراد یا همان موضوع را بررسی کنید و در صورت وجود، '
      || 'به آن‌ها ارجاع دهید. سپس بر پایهٔ متن پیاده‌شده، خلاصه‌ای دقیق و بدون '
      || 'حدس بنویسید. آنچه در متن نیامده را ننویسید. '
      || '(You summarise work conversations. Before writing, use the search tools '
      || 'to look for earlier calls with the same people or on the same subject, '
      || 'and cite them if there are any. Then write an accurate summary from the '
      || 'transcript, with no guessing. Never write what is not in the transcript.)',
       updated_at = now()
 where level = 'system'
   and slug  = 'summarizer';

-- ---------------------------------------------------------------------------
-- Self-check.
--
-- The first assertion is the negative control and it is what proves the UPDATE
-- found its row at all: a migration with a typo'd slug would leave the old
-- prompt in place, and every "the new text is present" check below would have
-- to fail — but only if something also asserts the OLD text is gone. 0219's
-- sentence is the one that has to have disappeared.
-- ---------------------------------------------------------------------------
do $check$
declare
  v_prompt text;
begin
  select prompt into v_prompt
    from echo.skill where level = 'system' and slug = 'summarizer';

  if v_prompt is null then
    raise exception '0222: there is no system summarizer skill to correct';
  end if;

  -- 0219's Persian-only statement of the rule is gone…
  if position('خلاصه را به همان زبانی بنویسید' in v_prompt) > 0 then
    raise exception '0222: the Persian-only statement of the language rule is still here';
  end if;
  -- …and 0015's original promise has certainly not come back.
  if position('خروجی همیشه فارسی است' in v_prompt) > 0 then
    raise exception '0222: the summarizer promises Persian output unconditionally';
  end if;

  -- Both statements of the rule, and the rule is FIRST.
  if position('زبان خلاصه همان زبان جلسه است' in v_prompt) <> 1 then
    raise exception '0222: the language rule is not the first thing in the prompt';
  end if;
  if position('the language of the meeting' in v_prompt) = 0 then
    raise exception '0222: the English statement of the language rule is missing';
  end if;

  -- What was NOT meant to change, in both languages this time.
  if position('تماس‌های پیشین' in v_prompt) = 0
     or position('use the search tools' in v_prompt) = 0 then
    raise exception '0222: the instruction to check prior calls was lost';
  end if;
  if position('آنچه در متن نیامده را ننویسید' in v_prompt) = 0
     or position('Never write what is not in the transcript' in v_prompt) = 0 then
    raise exception '0222: the refusal to write what is not in the transcript was lost';
  end if;

  -- An org's own summarizer skill is that org's.
  if exists (
    select 1 from echo.skill
     where slug = 'summarizer' and level <> 'system'
       and position('the language of the meeting' in prompt) > 0
       and updated_at >= now() - interval '1 minute'
  ) then
    raise exception '0222: an organisation-level summarizer skill was rewritten';
  end if;
end
$check$;

commit;
