-- Local stand-in for Supabase Auth.
--
-- Never applied to a real deployment — the test harness installs it before
-- migrations so that echo.app_user's foreign key to auth.users is exercised
-- here exactly as it is in production. If this file ever grows a policy or a
-- behaviour, it has stopped being a shim.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);
