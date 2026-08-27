-- 0103 — the organisation logo becomes a FILE.
--
-- User directive, 2026-08-26: "the logo must be an image file that can be
-- uploaded, not a link." 0102 shipped a URL because this deployment has no
-- image-upload path anywhere; the directive is to build one.
--
-- WHERE THE BYTES LIVE, and why not object storage: the platform's only
-- bucket is call-audio, which by M10's ruling holds ZERO policies and is
-- reached exclusively through a server-side signer. A logo is the opposite
-- kind of object — small, public-facing within the org, and read on every
-- page that shows the org's name. Standing up a second bucket with its own
-- policy surface for one 200KB file is more wall than the thing behind it.
--
-- So the bytes ride the row they describe. One org, one logo, bounded by a
-- check the api restates: at 512KB the column is smaller than a single
-- second of the audio this database already handles by reference.
--
-- The MIME type travels WITH the bytes and is constrained to a short list.
-- Serving bytes back under a type the uploader chose is how a stored image
-- becomes a stored script: the api validates the magic bytes, and this
-- column can only ever hold one of four values regardless.

begin;

alter table echo.org
  add column logo_bytes bytea,
  add column logo_mime  text,
  -- whole-or-nothing: a mime with no bytes describes nothing, and bytes
  -- with no mime cannot be served
  add constraint org_logo_whole check ((logo_bytes is null) = (logo_mime is null)),
  add constraint org_logo_bounded check (
    logo_bytes is null or octet_length(logo_bytes) <= 524288
  ),
  add constraint org_logo_mime check (
    logo_mime is null or logo_mime in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
  );

comment on column echo.org.logo_bytes is
  'the organisation logo itself, at most 512KB. Stored here rather than in object storage: the only bucket this platform has is audio-only by ruling, and a second bucket for one small file is more policy surface than the file is worth.';

commit;
