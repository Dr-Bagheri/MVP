-- 0174 — answer the question you were asked
--
-- User directive, 2026-09-04: "for agents i want them to act more like a bot
-- than an agent, so i need them to answer when i asked them a question … and
-- if i did not ask about what they can do they should not answer me about what
-- they can do, i do not need too much details."
--
-- The screenshot that produced it: «سلام» → four paragraphs from Roya about
-- who she is, a bulleted list of her four capabilities, and a closing offer to
-- help. Nothing in it was untrue and none of it was asked for.
--
-- 0163's prompts say what each agent IS and what it may not fabricate, which
-- is right and stays word for word. What they never said is how much to write,
-- so each turn opens by re-establishing the persona — which is the ordinary
-- behaviour of a model handed a persona prompt and no instruction about length.
-- A capability list is the most expensive possible answer to «سلام»: it is
-- long, it is the same every time, and it pushes the actual answer below the
-- fold on the one screen where the answer is the product.
--
-- So both prompts gain a BREVITY clause, and it is phrased as a prohibition on
-- one specific behaviour rather than as "be brief" — a model reads "be
-- concise" as a style note and writes four shorter paragraphs. "Do not list
-- what you can do unless asked" is a thing it can either do or not do.
--
-- The clause is APPENDED rather than replacing the prompt: the anti-fabrication
-- sentences are the ones that keep a reply addressed to somebody outside the
-- building honest, and rewriting a prompt in order to shorten its output is how
-- a safety clause gets lost in a style change.

begin;

update echo.assistant_agent
   set instructions = instructions || ' ' ||
     'کوتاه بنویس. به همان چیزی پاسخ بده که پرسیده شده و نه بیشتر: اگر کسی نپرسیده '
     || 'چه کارهایی از تو برمی‌آید، فهرست توانایی‌هایت را ننویس و خودت را دوباره '
     || 'معرفی نکن. برای یک سلام، یک جمله بس است. وقتی جواب کوتاه درست است، همان '
     || 'را بنویس؛ توضیح اضافه ارزش نیست.'
 where level = 'system'
   and handle in ('roya', 'ava')
   /* idempotent, and re-runnable after a prompt edit: appending twice would
      give the model the same instruction in two voices, which is the shape of
      a prompt that slowly stops meaning anything */
   and position('فهرست توانایی‌هایت را ننویس' in instructions) = 0;

-- ── self-checks ──────────────────────────────────────────────────────────
do $chk$
declare
  v_with int;
  v_kept int;
begin
  select count(*) into v_with
    from echo.assistant_agent
   where level = 'system'
     and position('فهرست توانایی‌هایت را ننویس' in instructions) > 0;
  if v_with <> 2 then
    raise exception
      'CHECK FAILED: expected both system agents to carry the brevity clause, found %',
      v_with;
  end if;

  -- and the clause that matters MORE is still there. An update that shortened
  -- the output by dropping the anti-fabrication sentences would satisfy the
  -- check above perfectly, which is exactly why this one exists: the point of
  -- appending was to keep these, so the migration asserts it kept them.
  select count(*) into v_kept
    from echo.assistant_agent
   where level = 'system'
     and (position('نساز' in instructions) > 0 or position('حدس' in instructions) > 0);
  if v_kept <> 2 then
    raise exception
      'CHECK FAILED: an anti-fabrication clause was lost while shortening — % of 2 kept',
      v_kept;
  end if;
end $chk$;

commit;
