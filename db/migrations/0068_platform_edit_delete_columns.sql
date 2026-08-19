-- NeurAI Platform — 0068: metadata edit + soft-delete groundwork (M32 extension).
--
-- The platform-root role gains two abilities the user directed (2026-08-19):
-- edit organisation/user METADATA, and soft-delete either with a 7-day
-- recovery window before purge. This stays inside M32's wall: the new columns
-- and (in 0069) the new definer functions touch lifecycle/identity metadata
-- only. No policy on a content table names actor_is_platform_root(), so calls,
-- transcripts, conversations, keys and connectors remain denied by RLS. Every
-- new action is audited through record_platform_audit (metadata, never
-- content).
--
-- Columns and enum values land here; the functions that USE the new enum
-- values land in 0069 — a new enum value may not be used in the same
-- transaction that adds it.

-- Soft-delete bookkeeping. Nullable, default null, so the product's normal
-- operation is unchanged; access for a soft-deleted entity is enforced the
-- existing way (org.status='suspended' / app_user.status='disabled'), while
-- these columns drive the recovery window and the platform "deleted" view.
alter table echo.org
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references echo.app_user(id) on delete set null,
  add column if not exists purge_after  timestamptz;

alter table echo.app_user
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references echo.app_user(id) on delete set null,
  add column if not exists purge_after  timestamptz;

-- New audited actions for the edit + soft-delete/restore operations.
alter type echo.platform_audit_action add value if not exists 'org_updated';
alter type echo.platform_audit_action add value if not exists 'user_updated';
alter type echo.platform_audit_action add value if not exists 'org_deleted';
alter type echo.platform_audit_action add value if not exists 'org_restored';
alter type echo.platform_audit_action add value if not exists 'user_deleted';
alter type echo.platform_audit_action add value if not exists 'user_restored';
