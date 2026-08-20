-- NeurAI Platform — 0070: FORCE row level security on the platform tables.
--
-- Found by the 2026-08-20 tenancy audit. 0066 created echo.platform_operator
-- and echo.platform_audit with RLS ENABLED but not FORCED — the only two
-- tables in the schema missing the second half, and they are precisely the
-- two intentionally cross-tenant tables, where owner-side enforcement matters
-- most. The house rule ("every table gets RLS enabled AND forced",
-- db/README.md) already has a running tripwire — db/test/50 counts every
-- echo table and fails on exactly this — but the suite had not been run
-- against the catalogue since 0066 landed, so the omission sat silent.
-- This migration restores the invariant; the existing test keeps it.
--
-- Practical exposure was low (echo_app does not own the tables, so RLS still
-- applied to it, and every write goes through owner-run definer functions),
-- but "low" is a fact about today's call sites, not about the wall.

alter table echo.platform_operator force row level security;
alter table echo.platform_audit    force row level security;
