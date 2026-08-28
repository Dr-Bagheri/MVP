-- 0128 — the assistant's spoken voice becomes the person's choice.
--
-- User directive (2026-08-28): "put in the assistant voice setting that
-- you can choose the gender of the ai voice assistant as well, both for
-- persian and english."
--
-- Two columns, not one: the Persian and English voices are different
-- models on different loopback ports (M37's piper serves one model per
-- process), and a person may want a different gender per language. Text
-- with a CHECK rather than an enum — the vocabulary is two words and an
-- enum would take a migration to say "neutral" someday.
--
-- Defaults keep the standing directive (2026-08-21: "a WOMAN's voice for
-- Persian" — the browser rung already prefers Edge's Dilara): female for
-- both. The stored value is a per-person preference, served on /v1/me and
-- written through PATCH /v1/me/assistant beside reply language and length.

begin;

alter table echo.app_user
  add column assistant_voice_fa text not null default 'female'
    constraint app_user_voice_fa_known check (assistant_voice_fa in ('female', 'male')),
  add column assistant_voice_en text not null default 'female'
    constraint app_user_voice_en_known check (assistant_voice_en in ('female', 'male'));

comment on column echo.app_user.assistant_voice_fa is
  'M37 voice choice (0128): which Persian TTS voice speaks for the assistant — female (mana) or male (gyro). A preference, not content.';
comment on column echo.app_user.assistant_voice_en is
  'M37 voice choice (0128): which English TTS voice speaks — female (amy) or male (ryan).';

commit;
