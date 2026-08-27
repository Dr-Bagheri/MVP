-- 0110 — three tables rejoin FORCE ROW LEVEL SECURITY (0070's rule).
--
-- 0070 forced RLS on every table then existing; signin_method (0078),
-- call_note (0079) and deletion_record (0085) arrived later with ENABLE
-- only — each forgot the second ALTER. The suite's negative-space check
-- (50_identity_search_gateway: "enabled AND forced") is exactly the
-- tripwire for this class, but it sat downstream of an earlier failure in
-- the same file since 0079's DELETE-grant drift, so the gap went
-- unmeasured for five days: a red file stops measuring everything after
-- its first failure.
--
-- Forcing is behavior-neutral for every legitimate path here: the
-- migration/maintenance role carries BYPASSRLS (which beats FORCE),
-- definer functions and triggers run as their bypassing owner, and the
-- application roles were already subject to the policies. What FORCE
-- closes is the table OWNER being silently policy-exempt when some future
-- path runs there without bypassrls — defense in depth, same as 0070.

alter table echo.signin_method   force row level security;
alter table echo.call_note       force row level security;
alter table echo.deletion_record force row level security;
