-- Echo — 0001: foundation.
--
-- Extensions, the `echo` schema, enums, the Persian search fold, and the
-- identity function every RLS policy in this database is built on.
--
-- Why a dedicated `echo` schema and not `public` (M8 addendum, see db/DECISIONS.md D1):
-- Supabase auto-exposes `public` through PostgREST. We never use PostgREST —
-- core/ is our only client — so putting product tables outside `public` means
-- a leaked anon/service key has no REST surface to aim at. RLS would still
-- hold, but the wall we don't have to defend is the best kind.

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest() for API-key hashes
create extension if not exists citext;     -- case-insensitive email / username

create schema if not exists echo;
comment on schema echo is
  'Echo product tables + the identity helpers RLS depends on. Deliberately not `public`: never exposed via PostgREST.';

-- ---------------------------------------------------------------------------
-- Enums. Spelled out rather than free text: the status column IS the pipeline
-- position (M7), and a typo must be a migration error, not a stuck call.
-- ---------------------------------------------------------------------------

create type echo.org_status   as enum ('active', 'suspended');
create type echo.user_status  as enum ('pending', 'active', 'disabled');
create type echo.member_role  as enum ('member', 'admin');
create type echo.call_scope   as enum ('private', 'org');

-- Per-call position. Per-part work is tracked on call_part.status.
create type echo.call_status as enum (
  'recording',    -- browser is still capturing parts into it
  'processing',   -- one or more parts are moving through the per-part DAG
  'linking',      -- link-speakers, across all parts
  'summarizing',  -- summarizer agent is running
  'ready',
  'failed'
);

-- Per-part position: upload → transcode → vad → transcribe → diarize (M7).
create type echo.part_status as enum (
  'pending',      -- row exists, bytes do not
  'uploaded',
  'transcoded',
  'vad_done',
  'transcribed',
  'diarized',
  'failed'
);

create type echo.skill_level      as enum ('system', 'org', 'user');
create type echo.agent_run_kind   as enum ('assistant', 'summarizer');
create type echo.agent_run_status as enum ('running', 'ok', 'error');
create type echo.call_source      as enum ('web', 'upload', 'gateway');

-- ---------------------------------------------------------------------------
-- Persian folding for search (M8).
--
-- Division of labour: core/ applies the full `faNormalize()` (the TS port of
-- neurai-mvp's fa_normalize — ZWNJ joining, punctuation spacing) to text
-- BEFORE insert and to the query string. That is the linguistic layer.
--
-- This function is the *index* layer: a deterministic, locale-independent
-- fold applied by the database itself, so the stored tsvector and a query
-- agree even if a caller forgets to normalize. It must never depend on
-- collation or word-boundary classes — Persian letters are not alphabetic
-- under a C locale, so \y / \m would silently misbehave.
-- ---------------------------------------------------------------------------

create function echo.fa_fold(t text) returns text
  language sql
  immutable
  parallel safe
  set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          translate(
            translate(
              replace(t, U&'\FEFB', U&'\0644\0627'),        -- ﻻ ligature → لا
              -- Arabic letterforms → Persian
              U&'\064A\0643\0629\06C0\0624\0625\0623\0671\0673',
              U&'\06CC\06A9\0647\0647\0648\0627\0627\0627\0627'
            ),
            -- Arabic-Indic ٠-٩ and Persian ۰-۹ digits → ASCII
            U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669'
              || U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
            '01234567890123456789'
          ),
          -- deleted outright (no counterpart in `to`): harakat, superscript
          -- alef, tatweel, ZWNJ, ZWJ, LRM, RLM
          U&'\064B\064C\064D\064E\064F\0650\0651\0652\0653\0654\0655\0670'
            || U&'\0640\200C\200D\200E\200F',
          ''
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function echo.fa_fold(text) is
  'Locale-independent Persian fold used to build every tsvector. Pairs with core/''s faNormalize(); see db/README.md.';

-- ---------------------------------------------------------------------------
-- Identity. Invariant 2: no DB access without a user identity attached.
--
-- Two ways an identity arrives, both through core/'s single connection
-- factory (M3), both landing in the same place:
--   * a request with a Supabase JWT  → factory issues SET LOCAL echo.actor_id
--   * a pipeline job run as the call's owner → same, built from the row (M3)
-- The JWT claim is read as a fallback so a direct Supabase session still
-- resolves. SET LOCAL, never SET: identity must not outlive the transaction
-- on a pooled connection.
-- ---------------------------------------------------------------------------

create function echo.actor_id() returns uuid
  language plpgsql
  stable
  parallel safe
  set search_path = ''
as $$
declare
  raw    text;
  claims text;
begin
  raw := nullif(current_setting('echo.actor_id', true), '');
  if raw is not null then
    return raw::uuid;
  end if;

  -- Fallback: Supabase puts the verified JWT payload here. Malformed JSON is
  -- treated as "no identity" rather than an error — fail closed, not loud.
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '');
    if claims is not null then
      return nullif(claims::jsonb ->> 'sub', '')::uuid;
    end if;
  exception when others then
    return null;
  end;

  return null;
end;
$$;

comment on function echo.actor_id() is
  'The acting user, or NULL. NULL means every RLS policy in this schema denies. Set only by core/''s connection factory via SET LOCAL.';

-- ---------------------------------------------------------------------------
-- Shared trigger helper.
-- ---------------------------------------------------------------------------

create function echo.tg_set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
