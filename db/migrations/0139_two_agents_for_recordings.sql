-- 0139 — two shipped agents whose subject is the recording itself.
--
-- User directive, 2026-08-29: recording should be available to the agents,
-- and there should be workflows for it and agents carrying them.
--
-- ── what "available to the agents" already means, and what it cannot ────
-- `start_recording` is a CLIENT tool: the model asks the person's own
-- surface to start a take, and the surface — holding the microphone — does
-- it. That has worked from the voice orb for a while; what was missing is
-- that the assistant PAGE advertised no client tools at all, so a typed ask
-- (which is every ask made through an agent) reached a model that had been
-- told about none of them. That is fixed in the same commit as this file,
-- and it is the whole of "agents can start a call".
--
-- What is NOT possible, stated here so nobody builds it twice: a workflow
-- STEP that starts a recording. Steps execute in the worker, which has no
-- microphone and no browser. A `record` kind would be a producer the
-- executor could never consume — and a scheduled workflow reaching one at
-- 3 a.m. would fail every night, quietly, on a machine nobody is watching.
-- So the two new starter workflows fire AFTER a take (call.transcribed and
-- call.summarized) and the starting stays where the microphone is.
--
-- ── why these two agents rather than one ────────────────────────────────
-- They answer different questions about the same material and would give
-- worse answers merged. The recorder's assistant is about the take that
-- just happened — what was it, what was decided. The commitments assistant
-- is about who now owes what, which is a reading ACROSS takes and needs a
-- different instinct about evidence: a promise attributed to the wrong
-- person is worse than no promise found.
--
-- Tools are the same four read tools every shipped agent carries. Neither
-- gets a write tool: what they produce is read by the person who asked, and
-- blast radius decides reach (M44).

begin;

insert into echo.assistant_agent
  (level, handle, name, description, instructions, tools, icon, color, web)
values
  ('system', 'recorder', 'دستیار ضبط',
   'دربارهٔ همین ضبط: موضوع، تصمیم‌ها و آنچه باز ماند — و می‌تواند به‌خواست شما ضبط تازه‌ای را شروع کند.',
   'You are the recording assistant of this platform. Your material is the user''s own recordings: the take that just happened, its transcript and summary, reached through your tools under the caller''s own access. Answer about THIS recording first — what it was about, what was decided, what was left open — and name the moment each fact came from. You can also start a new recording when the person asks: the surface performs it and may ask them for the microphone first, so say what you are doing rather than claiming it is already running. When the records hold nothing, say so plainly. Answer in the language the user writes.',
   '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
   'mic', 'violet', false),
  ('system', 'commitments', 'دستیار قول‌ها',
   'از دل ضبط‌ها درمی‌آورد چه کسی چه چیزی را بر عهده گرفته و تا کِی — با شاهد از خود گفت‌وگو.',
   'You are the commitments assistant of this platform. Your material is the user''s own recordings, reached through your tools under the caller''s own access. Find what people took on: who owes what, to whom, by when. Every commitment must be attributed to a named speaker and quoted from the conversation — an obligation put on the wrong person is worse than one you failed to find, so when a speaker is uncertain say the commitment exists and the speaker is unclear. Never infer a deadline nobody stated. When the records hold none, say so plainly. Answer in the language the user writes.',
   '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
   'check', 'lime', false)
-- the partial unique index from 0065 — its predicate must be quoted in
-- full or Postgres cannot match the ON CONFLICT to it
on conflict (handle) where level = 'system' and archived_at is null do nothing;

commit;
