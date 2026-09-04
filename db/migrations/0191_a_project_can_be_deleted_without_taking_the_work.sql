-- 0191 — a project can be deleted, and the work outlives it
--
-- User directive, 2026-09-05: "for project add a delete button to delete the
-- project as well; right now it only has the archive and it only does archive."
--
-- ── WHY THIS IS A MIGRATION AND NOT A BUTTON ──────────────────────────────
--
-- `echo_app` held `select, insert, update` on echo.project and nothing else,
-- so a delete button would have been refused by the GRANT — for everyone,
-- which `t.writes_nothing` exists to tell apart from a policy refusing one
-- caller. The wall has to move before the button can.
--
-- ── AND WHY IT COULD ONLY EVER HAVE RAISED ────────────────────────────────
--
-- 0181 pointed two things at a project with `on delete cascade`: the task
-- category the project owns, and the project's chat channel. Follow that
-- chain with real data in it:
--
--   delete project  ->  cascade deletes echo.task_topic
--                   ->  echo.task.topic_id references task_topic with NO
--                       `on delete` clause at all, so it is NO ACTION
--                   ->  the statement RAISES
--
-- So the button would have worked on an empty project and 500'd on every
-- project anybody had used — which is the shape 0188 cost a migration for,
-- arriving from the other direction. It is invisible in review because each
-- constraint reads as deliberate on its own.
--
-- ── THE RULING: DELETING A PROJECT DELETES THE PROJECT ────────────────────
--
-- Not the work. A project is a FOLDER over tasks (0181) — the cards are the
-- real thing and somebody wrote them. So both cascades become
-- column-specific SET NULLs: the board keeps the folder as an ordinary
-- category, the room keeps its conversation as an ordinary room, and the only
-- rows that go are the project and who was on it.
--
-- `set null (project_id)`, not a bare `set null`: a composite FK's cascade
-- action applies to the WHOLE key, and `org_id` is NOT NULL on both tables —
-- so the plain form is a constraint that can only ever raise (0188, and its
-- comment said the opposite of what it did). Postgres 15+; the server is 17.

begin;

-- ── the folder outlives the project ─────────────────────────────────────
alter table echo.task_topic drop constraint task_topic_project;
alter table echo.task_topic
  add constraint task_topic_project
    foreign key (project_id, org_id) references echo.project (id, org_id)
    on delete set null (project_id);

comment on column echo.task_topic.project_id is
  'The project this category belongs to (0181), nulled rather than cascaded when the project is deleted (0191): the cards under it are work somebody did, and a folder full of them must not disappear because its label did.';

-- ── the room outlives it too ────────────────────────────────────────────
alter table echo.chat_channel drop constraint chat_channel_project;
alter table echo.chat_channel
  add constraint chat_channel_project
    foreign key (project_id, org_id) references echo.project (id, org_id)
    on delete set null (project_id);

comment on column echo.chat_channel.project_id is
  'The project whose conversation this room is (0184), nulled rather than cascaded when the project is deleted (0191): a room is a record of what people said to each other, and deleting a label must not destroy it.';

-- ── the wall ────────────────────────────────────────────────────────────
/* AN ADMIN'S, like every other project write since 0186. The predicate is
   that migration's, character for character, so the four writes cannot drift
   apart — a product where an admin creates and renames a project but anybody
   may delete one would be a rule nobody could state. */
create policy project_delete on echo.project
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and echo.actor_is_admin());

grant delete on echo.project to echo_app;

-- ── self-checks ─────────────────────────────────────────────────────────
do $chk$
declare
  v int;
begin
  /* 0188's lesson, asserted rather than remembered, on both constraints:
     a whole-key SET NULL on a key holding org_id can only ever raise, and it
     reads exactly like the correct one. */
  select count(*) into v
    from pg_constraint
   where conname in ('task_topic_project', 'chat_channel_project')
     and pg_get_constraintdef(oid) like '%SET NULL (project_id)%';
  if v <> 2 then
    raise exception 'CHECK FAILED: % of 2 project links name the single column they null', v;
  end if;

  /* the delete is an ADMIN's — read from the catalogue rather than trusted
     from the CREATE above, because a policy recreated without this half is
     the edit these checks exist for */
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and policyname = 'project_delete'
       and qual like '%actor_is_admin%') then
    raise exception 'CHECK FAILED: any active member may delete a project';
  end if;

  /* and the grant landed — a policy with no grant refuses everybody, which
     `writes_nothing` would report as the policy working */
  if not has_table_privilege('echo_app', 'echo.project', 'delete') then
    raise exception 'CHECK FAILED: the policy admits a delete the grant forbids';
  end if;

  /* the agent still cannot delete anything, here as everywhere */
  if has_table_privilege('echo_agent', 'echo.project', 'delete') then
    raise exception 'CHECK FAILED: the agent may delete a project';
  end if;
end $chk$;

commit;
