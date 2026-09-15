-- 0219 — a summary speaks the MEETING's language, not always Persian.
--
-- Found while rehearsing the live demo, 2026-09-09: an English organisation
-- seeded from the console (M52), an English recording, an English transcript
-- — and a Persian summary. Every decision, every action item, every owner
-- line came back in Persian on a screen where nothing else was.
--
-- The cause is one sentence in the system `summarizer` skill that 0015 wrote:
-- «خروجی همیشه فارسی است» — "the output is always Persian". That was true of
-- the product v1 shipped, which had one organisation and one language. It
-- stopped being true when M52 made an ENGLISH organisation something the
-- console can create, and it was never true of an org that records in a
-- language nobody on the team reads.
--
-- ── WHY THE PROMPT AND NOT A PARAMETER ────────────────────────────────────
--
-- The obvious alternative is to pass the call's `language` into the
-- summariser and pin the output to it. It was refused on the evidence in
-- front of us: `echo.call.language` is DETECTED, and the demo's own live take
-- detected `en` correctly only because every line was English. A meeting held
-- in two languages — which is the normal case for this product's users, who
-- switch mid-sentence — has one `language` value and two languages in the
-- transcript. Pinning to the detected value would then produce a summary in
-- the language that happened to win a majority vote, confidently, with no
-- signal that a choice was made.
--
-- The transcript itself is the better authority, and the model is already
-- reading it. So the rule is stated as a rule about the TRANSCRIPT: write in
-- the language the meeting was held in, and when a meeting is held in two,
-- follow the one the decisions were made in. That degrades honestly — a
-- borderline call produces a summary in one of the two languages actually
-- spoken, never in a third.
--
-- ── WHY A MIGRATION, WHEN 0015 SAYS core/ OWNS THE WORDING ────────────────
--
-- 0015's own comment: "Editable through the product without a deploy; core/
-- owns refining the wording, this migration only guarantees the row exists."
-- That remains true, and this migration does not take the wording back. It
-- corrects the row 0015 INSERTED, because that row is what every deployment
-- starts from and what every new organisation inherits — an org-level skill
-- written by hand fixes one customer, and the next one seeded meets the same
-- Persian summary. The `update … where level = 'system'` touches exactly the
-- one row 0015 wrote and never an organisation's own override (M4: a skill an
-- org has edited is that org's, and a migration must not rewrite it).
--
-- Everything else in the prompt is left alone on purpose: the instruction to
-- search prior calls first, the refusal to guess, and the tool list are all
-- still the behaviour we want. Only the language sentence changes.

begin;

update echo.skill
   set prompt =
         'شما خلاصه‌ساز گفتگوهای کاری هستید. قبل از نوشتن، با ابزارهای جست‌وجو '
      || 'تماس‌های پیشین با همان افراد یا همان موضوع را بررسی کنید و در صورت وجود، '
      || 'به آن‌ها ارجاع دهید. سپس بر پایهٔ متن پیاده‌شده، خلاصه‌ای دقیق و بدون '
      || 'حدس بنویسید. خلاصه را به همان زبانی بنویسید که جلسه به آن برگزار شده '
      || 'است: اگر متن پیاده‌شده فارسی است، فارسی؛ اگر انگلیسی است، انگلیسی. '
      || 'اگر جلسه دوزبانه بوده، زبانی را انتخاب کنید که تصمیم‌ها به آن گرفته '
      || 'شده‌اند. زبان خودتان را بر جلسه تحمیل نکنید. '
      || 'آنچه در متن نیامده را ننویسید. '
      || '(Write the summary in the language the meeting was held in — Persian '
      || 'for a Persian transcript, English for an English one. Never translate '
      || 'the meeting into a language nobody spoke.)',
       updated_at = now()
 where level = 'system'
   and slug  = 'summarizer';

-- ---------------------------------------------------------------------------
-- Self-check: the row exists, it no longer promises Persian unconditionally,
-- and it now says the language follows the transcript — in both languages,
-- because a model reading a Persian prompt needs the rule in Persian and the
-- English sentence is what makes it unambiguous for an English transcript.
--
-- The negative control matters as much as the assertion: a version of this
-- migration that updated NOTHING (a typo'd slug, a level that does not match)
-- would leave the old prompt in place, and every check below would still have
-- to fail. So the first assertion is that the OLD sentence is gone, which is
-- only true if this migration's UPDATE actually found its row.
-- ---------------------------------------------------------------------------
do $check$
declare
  v_prompt text;
begin
  select prompt into v_prompt
    from echo.skill where level = 'system' and slug = 'summarizer';

  if v_prompt is null then
    raise exception '0219: there is no system summarizer skill to correct';
  end if;

  if position('خروجی همیشه فارسی است' in v_prompt) > 0 then
    raise exception '0219: the summarizer still promises Persian output unconditionally';
  end if;

  if position('به همان زبانی' in v_prompt) = 0 then
    raise exception '0219: the Persian statement of the language rule is missing';
  end if;

  if position('the language the meeting was held in' in v_prompt) = 0 then
    raise exception '0219: the English statement of the language rule is missing';
  end if;

  -- What was NOT meant to change. If a later edit drops the search-first
  -- instruction or the refusal to guess while rewording the language rule,
  -- this is where it is caught.
  if position('تماس‌های پیشین' in v_prompt) = 0 then
    raise exception '0219: the instruction to check prior calls was lost';
  end if;

  if position('آنچه در متن نیامده را ننویسید' in v_prompt) = 0 then
    raise exception '0219: the refusal to write what is not in the transcript was lost';
  end if;

  -- An org's own summarizer skill is that org's. Nothing above may have
  -- touched one, and this proves the WHERE clause is narrow rather than
  -- merely looking narrow.
  if exists (
    select 1 from echo.skill
     where slug = 'summarizer' and level <> 'system'
       and position('the language the meeting was held in' in prompt) > 0
       and updated_at >= now() - interval '1 minute'
  ) then
    raise exception '0219: an organisation-level summarizer skill was rewritten';
  end if;
end
$check$;

commit;
