-- Echo — 0039: a handle, and a Latin name (M24 amendment, user review 1).
--
-- ===========================================================================
-- username is unique PER ORG, not globally.
--
-- Global uniqueness looks tidier and is a cross-tenant information leak: "that
-- handle is taken" would tell a stranger that someone, somewhere in another
-- customer's organization, wears it. Handle registration would become an
-- existence oracle over every org in the system — precisely what M2's wall
-- exists to prevent, arriving through a signup form rather than a query.
--
-- Per-org uniqueness is also all the product needs: a mention resolves among
-- people you can already see, and you can only see your own org.
-- ===========================================================================

alter table echo.app_user
  add column username text,
  add column display_name_en text;

-- Lowercase ASCII, starts with a letter, 3–32 characters.
--
-- Not a style preference in a bidirectional product: an @mention sits inline
-- in running text, and a Persian handle inside an LTR-embedded run leaves the
-- boundary of the handle genuinely ambiguous — where the name ends becomes a
-- question about bidi resolution rather than about characters. Latin handles
-- keep mentions parseable and any future /u/<handle> route URL-safe. The
-- person's real name is display_name, which is Persian and unconstrained.
alter table echo.app_user
  add constraint app_user_username_format
  check (username is null or username ~ '^[a-z][a-z0-9_]{2,31}$');

-- NULL is "no handle yet", and stays possible: the column is not NOT NULL,
-- because forcing one at insert time would make register_account invent a
-- handle for someone who has not chosen it.
create unique index app_user_username_per_org
  on echo.app_user (org_id, username) where username is not null;

-- An empty string is not a name. Without this, '' would silently render as a
-- blank Latin name instead of falling back to the Persian one — the fallback
-- would be there and would never fire.
alter table echo.app_user
  add constraint app_user_display_name_en_not_blank
  check (display_name_en is null or length(btrim(display_name_en)) > 0);

comment on column echo.app_user.username is
  'Stable handle, unique within the org (never globally — that would be a cross-tenant existence oracle). Reference people by id; a handle is for humans to type.';
comment on column echo.app_user.display_name_en is
  'Latin name for the en locale. NULL falls back to display_name — never auto-transliterated, because a machine-guessed spelling of someone''s name is a wrong name.';

-- ---------------------------------------------------------------------------
-- Backfill, so mentions work for people who already exist.
--
-- Derived from the email local part, which is the closest thing to a handle
-- they have already chosen. Deterministic and collision-free by construction:
-- the base is clamped to 28 characters before a per-org sequence number is
-- appended, so the result always fits the 32-character limit.
-- ---------------------------------------------------------------------------

with base as (
  select
    u.id,
    u.org_id,
    left(
      case
        when regexp_replace(lower(split_part(u.email::text, '@', 1)), '[^a-z0-9_]', '', 'g') ~ '^[a-z]'
        then regexp_replace(lower(split_part(u.email::text, '@', 1)), '[^a-z0-9_]', '', 'g')
        else 'u' || regexp_replace(lower(split_part(u.email::text, '@', 1)), '[^a-z0-9_]', '', 'g')
      end || '___',            -- guarantees the 3-character minimum
      28
    ) as handle
  from echo.app_user u
  where u.username is null
),
numbered as (
  select id, handle,
         row_number() over (partition by org_id, handle order by id) as n
  from base
)
update echo.app_user u
   set username = case when x.n = 1 then x.handle else x.handle || x.n::text end
  from numbered x
 where x.id = u.id;
