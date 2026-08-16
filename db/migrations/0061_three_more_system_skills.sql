-- Echo — 0061: three more system skills (user directive, 2026-08-16:
-- "add more skills … like tasks and a couple more").
--
-- Same contract as the summarizer (0015): system rows are shipped
-- configuration — editable through the product without a deploy, immutable
-- through the API (M29), names localized at the UI for the English context
-- (system skills are product content; authored skills never translate).
--
-- All three are READ-tool skills: they examine transcripts and answer.
-- Anti-fabrication is in every prompt for the same reason it is in the
-- summarizer's: a skill that invents an action item costs someone a real
-- afternoon.

insert into echo.skill (level, slug, name, description, prompt, tools, starter_questions)
values
(
  'system',
  'tasks',
  'استخراج کارها',
  'Pulls action items out of a call: who does what, by when.',
  'شما استخراج‌کنندهٔ کارها از گفتگوهای کاری هستید. متن پیاده‌شده را با '
  || 'ابزارها بخوانید و فهرست کارهای توافق‌شده را بیرون بکشید: هر کار، '
  || 'مسئول آن (اگر گفته شد)، و مهلت آن (اگر گفته شد). اگر مسئول یا مهلت '
  || 'در متن نیامده، همان را بنویسید — «نامشخص» — و حدس نزنید. '
  || 'خروجی فهرستی شماره‌دار و فارسی است. کاری که در متن نیامده را نسازید.',
  '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
  '["کارهای این تماس را فهرست کن", "چه کارهایی به من سپرده شد؟", "مهلت‌های گفته‌شده را جمع کن"]'::jsonb
),
(
  'system',
  'decisions',
  'تصمیم‌ها',
  'Lists the decisions a call actually made, with who made them.',
  'شما ثبت‌کنندهٔ تصمیم‌های جلسه هستید. متن پیاده‌شده را با ابزارها بخوانید '
  || 'و فقط تصمیم‌های واقعاً گرفته‌شده را فهرست کنید — نه پیشنهادها و نه '
  || 'بحث‌های بی‌نتیجه. برای هر تصمیم بنویسید: چه تصمیمی، چه کسی گرفت '
  || '(اگر روشن است)، و در چه لحظه‌ای از گفتگو. اگر جلسه تصمیمی نگرفت، '
  || 'همین را صریح بگویید. خروجی فارسی است و چیزی جز متن مبنا ندارد.',
  '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
  '["در این تماس چه تصمیم‌هایی گرفته شد؟", "چه چیزهایی بی‌نتیجه ماند؟"]'::jsonb
),
(
  'system',
  'minutes',
  'صورت‌جلسه',
  'Drafts formal meeting minutes from the transcript.',
  'شما نویسندهٔ صورت‌جلسه هستید. بر پایهٔ متن پیاده‌شده، صورت‌جلسه‌ای '
  || 'رسمی و فشرده بنویسید: موضوع، حاضران (به همان نامی که در متن آمده)، '
  || 'خلاصهٔ مباحث به ترتیب طرح، تصمیم‌ها، و کارهای سپرده‌شده. آنچه در '
  || 'متن نیامده در صورت‌جلسه جایی ندارد؛ نام‌ها را هرگز تغییر ندهید. '
  || 'خروجی فارسی است.',
  '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
  '["صورت‌جلسهٔ این تماس را بنویس", "خلاصهٔ رسمی برای ارسال به تیم آماده کن"]'::jsonb
);
