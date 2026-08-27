-- 0102 — the organisation's public face.
--
-- User directive, 2026-08-26: "add a General for the landing page in
-- Management with image options". The org row has carried only its name,
-- locale, model allow-list and glossary; everything a landing page would
-- show had nowhere to live.
--
-- All nullable, all defaulting to absent: an organisation that fills none
-- of this is not incomplete, it simply has not published a face. The empty
-- string is NOT a second spelling of absent — the api sends null to clear,
-- and the check constraints refuse a blank string so the two states cannot
-- both exist for one field.
--
-- `logo_url` is a URL rather than an upload for one honest reason: this
-- product has no image-upload path at all (the same absence that made
-- app_user.avatar_url a KNOWN_ABSENT). A column that stored bytes nobody
-- could put there would be the register_account shape again. A link is
-- something an admin can actually use today, and it is the same column an
-- upload would write into later.

begin;

alter table echo.org
  add column public_email text check (public_email is null or char_length(btrim(public_email)) between 3 and 200),
  add column description  text check (description  is null or char_length(btrim(description))  between 1 and 500),
  add column website_url  text check (website_url  is null or char_length(btrim(website_url))  between 3 and 300),
  add column location     text check (location     is null or char_length(btrim(location))     between 1 and 120),
  add column logo_url     text check (logo_url     is null or char_length(btrim(logo_url))     between 3 and 500),
  -- bounded like the glossary (0088): a list, not a text dump
  add column social_links text[] not null default '{}',
  add constraint org_social_links_bounded check (
    array_length(social_links, 1) is null or array_length(social_links, 1) <= 6
  );

comment on column echo.org.logo_url is
  'a link to the organisation logo. A URL and not an upload because this deployment has no image-upload path yet; the same column takes the uploaded address when one exists.';

commit;
