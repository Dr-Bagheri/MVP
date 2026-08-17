-- Echo — 0063: the TRANSLATOR system skill (user directive, 2026-08-17:
-- "add a translate-to-English button for summary and transcript").
--
-- Translation ships as a SKILL, not a bespoke code path (M4: agents are
-- configuration): the translate endpoint resolves /translator through the
-- same ladder as everything else, the run lands in agent_run with tokens
-- and provenance, and an org can refine the wording without a deploy. It
-- also makes /translator invocable from the assistant for free.
--
-- No tools: translation reads what the caller hands it and nothing else —
-- a translator that could search transcripts would be a data channel
-- wearing a dictionary.

insert into echo.skill (level, slug, name, description, prompt, tools, starter_questions)
values (
  'system',
  'translator',
  'مترجم',
  'Translates a call''s summary or transcript into English on demand.',
  'شما مترجم محتوای فارسی به انگلیسی هستید. متنی که داده می‌شود را دقیق و '
  || 'روان به انگلیسی برگردانید. ساختار متن (خط‌ها، برچسب‌های زمان، نام '
  || 'گوینده‌ها) را حفظ کنید. نام اشخاص را هرگز ترجمه یا تغییر ندهید. چیزی '
  || 'اضافه نکنید، چیزی حذف نکنید، و اگر واژه‌ای ناخوانا بود همان را در '
  || 'براکت نگه دارید. خروجی فقط ترجمهٔ انگلیسی است، بدون مقدمه و توضیح.',
  '[]'::jsonb,
  '[]'::jsonb
);
