-- Echo — 0079: timestamped notes and named chapters on a call (user
-- directive, 2026-08-22: "note pad beside the recorder … named chapters on
-- the fly").
--
-- One table, two kinds. A NOTE is a sentence someone wrote at a moment; a
-- CHAPTER is a name for the stretch that starts at a moment. Both are
-- annotations OF the call, not part of the record itself: the transcript
-- stays the source of truth (rule 6), and a note is its author's word,
-- attributed and separable.
--
-- Access model:
--  * read  — whoever can read the call (the note rides the call's scope).
--  * write — any call reader may add their OWN note (created_by = actor,
--    enforced structurally); annotating is not modifying the record, so
--    the 0077 hierarchy does not apply here.
--  * delete — the author deletes their own. No UPDATE at all: append-only,
--    delete-and-retype (an edited note is a new note).
--  * purge — ON DELETE CASCADE from the call, deliberately deviating from
--    the explicit per-table purge-policy pattern: a note has no life of its
--    own, cascade keeps the purge job's table list closed, and referential
--    actions run as the table owner so echo_purge needs nothing here.
--  * the AGENT has no grants on this table for now. Whether the summarizer
--    may read a call's notes is a real product decision (notes could steer
--    or contaminate a summary) — deliberately not smuggled in with the
--    table. When wanted, it is one grant + one policy, decided on record.

create table echo.call_note (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid not null,
  org_id     uuid not null,
  kind       text not null check (kind in ('note', 'chapter')),
  -- Milliseconds into the RECORDED take (the recorder's clock). NULL means
  -- un-anchored: a note about the call, not about a moment in it.
  at_ms      integer check (at_ms is null or at_ms >= 0),
  body       text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_by uuid not null references echo.app_user(id),
  created_at timestamptz not null default now(),

  -- The composite FK keeps a note inside its call's org structurally —
  -- the same pattern every call child uses (D9: constraint, not subquery).
  constraint call_note_call_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete cascade
);

create index call_note_call_idx on echo.call_note (call_id, at_ms);

comment on table echo.call_note is
  'Timestamped notes and named chapters on a call (0079). Annotations, not record: append-only, author-attributed, cascade-purged with the call.';

alter table echo.call_note enable row level security;

create policy call_note_read on echo.call_note
  for select to echo_app
  using (echo.can_read_call(call_id));

create policy call_note_insert on echo.call_note
  for insert to echo_app
  with check (
    created_by = echo.actor_id()
    and echo.can_read_call(call_id)
  );

create policy call_note_delete on echo.call_note
  for delete to echo_app
  using (
    created_by = echo.actor_id()
    and echo.can_read_call(call_id)
  );

grant select, insert, delete on echo.call_note to echo_app;
