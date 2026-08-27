-- 0112 — the settings batch: the assistant obeys its person, security gets
-- honest self-service, and invitations get a domain wall.
--
-- ── The assistant's per-person voice (Settings · Assistant 27/28/30/36) ──
-- Four columns on app_user, each consumed at a REAL site the same batch
-- wires (rule 13½ — no column lands without its reader):
--   assistant_reply_language  read at ask time; joins the language line.
--   assistant_reply_length    read at ask time; shapes the answer's size.
--   assistant_instructions    the person's standing instructions, appended
--                             to the system prompt AS user-authored config
--                             (their own words to their own assistant —
--                             trusted like the question itself, bounded).
--   post_call_brief           the M35 brief's per-person switch; the
--                             signal step skips WITH a log line, so the
--                             absence is a named choice, not a mystery.
--
-- ── The org's invitation domain wall (Sign-in methods 73) ────────────────
-- allowed_email_domains: when non-empty, an invitation to an address
-- outside the list is REFUSED AT CREATION, by name. Empty = no wall (the
-- role_capability posture: absence changes nothing). Joining is already
-- invitation-only by construction, so the wall sits on the only door.
--
-- ── Two D8-enumerated doors ──────────────────────────────────────────────
-- my_auth_sessions(): the caller's OWN sessions from auth.sessions —
--   device, ip, times, and a display handle. NEVER the token columns; the
--   function's select list is the wall. Sign-in HISTORY is deliberately
--   not offered from auth.audit_log_entries: that table is EMPTY on this
--   deployment, and an empty list rendered as "no history" would be
--   absent-because-unrecorded wearing absent-because-quiet.
-- clear_my_voiceprint(): a member erases their OWN voice print (the
--   person row linked via app_user_id). The directory's clear is
--   admin-walled; one's own biometric consent must not need an admin —
--   withdrawal is the other half of consent (Security 58/59).

begin;

alter table echo.app_user
  add column assistant_reply_language text
    check (assistant_reply_language is null or assistant_reply_language in ('fa', 'en')),
  add column assistant_reply_length text
    check (assistant_reply_length is null or assistant_reply_length in ('short', 'detailed')),
  add column assistant_instructions text
    check (assistant_instructions is null
           or char_length(assistant_instructions) between 1 and 2000),
  add column post_call_brief boolean not null default true;

comment on column echo.app_user.assistant_instructions is
  'Settings·Assistant: the person''s standing instructions to their own assistant. User-authored configuration, bounded; appended to the system prompt at ask time.';

alter table echo.org
  add column allowed_email_domains text[] not null default '{}'
    constraint org_domains_bounded
    check (coalesce(array_length(allowed_email_domains, 1), 0) <= 20);

comment on column echo.org.allowed_email_domains is
  'Sign-in methods: when non-empty, invitations outside these domains are refused at creation. Empty = no wall.';

-- ─── the caller's own sessions ──────────────────────────────────────────
create or replace function echo.my_auth_sessions()
returns table (handle text, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, ip text)
language sql
security definer
set search_path = ''
stable
as $$
  select left(s.id::text, 8), s.created_at, s.refreshed_at,
         s.user_agent, s.ip::text
    from auth.sessions s
   where s.user_id = echo.actor_id()
   order by coalesce(s.refreshed_at, s.created_at) desc
   limit 20
$$;

comment on function echo.my_auth_sessions() is
  'D8-enumerated: the caller''s OWN auth sessions — device/ip/times and a display handle. The select list is the wall: no token column can leave this function.';

revoke all on function echo.my_auth_sessions() from public;
grant execute on function echo.my_auth_sessions() to echo_app;

-- ─── withdrawing one's own voice print ──────────────────────────────────
create or replace function echo.clear_my_voiceprint()
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.person p
     set voiceprint = null,
         voiceprint_model = null,
         voiceprint_at = null,
         voiceprint_by = null
   where p.app_user_id = echo.actor_id()
     and p.merged_into is null
     and p.voiceprint is not null
  returning true
$$;

comment on function echo.clear_my_voiceprint() is
  'D8-enumerated: a member withdraws their OWN voice print (the person row linked by app_user_id). Withdrawal is the other half of consent and must not need an admin. Returns true when a print was erased; empty = there was none.';

revoke all on function echo.clear_my_voiceprint() from public;
grant execute on function echo.clear_my_voiceprint() to echo_app;

commit;
