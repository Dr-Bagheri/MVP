-- 0141 — a workflow can be set to start a recording when you run it.
--
-- User directive, 2026-08-29: "add the record start step in the related
-- workflow. it must have a seprate part that you can turn on in its box so
-- it start recording and use the mini recorder".
--
-- ── why a SWITCH on the workflow and not a step in its graph ────────────
-- I said no to a `record` step twice and owe the reason once more, because
-- the answer here is a yes to the same want.
--
-- Graph steps execute in the WORKER. It has no microphone and no browser,
-- so a step that starts a recording could never run there — and the manual
-- trigger route refuses a graph whose kinds are outside the executable set,
-- so such a workflow would not start at all. A kind the executor cannot
-- consume is a producer with no consumer wearing a feature's name.
--
-- What the person actually asked for does not need one. Turn this on and
-- the workflow starts a take WHEN YOU RUN IT, from the surface holding the
-- microphone, through the same engine the record button uses — so the mini
-- recorder appears in the top bar exactly as it does for any other take.
-- The recording and the workflow then run side by side: the take is being
-- captured while the graph does its work.
--
-- It is a property of the workflow rather than a step because that is what
-- it is — a fact about how this workflow starts, not an instruction inside
-- it. It also cannot half-work: a scheduled run of a flagged workflow
-- simply does not record, because there is nobody there to record, and the
-- flag is read only by a surface that has a person in front of it.
--
-- ── the grant comes with the column ────────────────────────────────────
-- Learned this morning at the cost of a broken feature (0134): a policy
-- governs who may write, and a GRANT decides whether the write is possible
-- at all. `echo.workflow` carries a table-level UPDATE for echo_app, so
-- this column is covered by it — checked rather than assumed, with
-- `has_column_privilege` at the foot of this file, because "covered by the
-- table grant" is exactly the kind of thing that is true until it isn't.

begin;

alter table echo.workflow
  add column if not exists starts_recording boolean not null default false;

comment on column echo.workflow.starts_recording is
  'M41/0141: when true, running this workflow from a person''s own surface starts a recording first, through the same engine the record button uses. Read ONLY by a client with a microphone — a scheduled run of a flagged workflow does not record, because nobody is there to record.';

-- the check that the write is actually possible (0134's lesson)
do $check$
begin
  if not has_column_privilege('echo_app', 'echo.workflow', 'starts_recording', 'UPDATE') then
    raise exception 'echo_app cannot UPDATE starts_recording — the column shipped without a grant behind it';
  end if;
  if not has_column_privilege('echo_app', 'echo.workflow', 'starts_recording', 'SELECT') then
    raise exception 'echo_app cannot SELECT starts_recording';
  end if;
end
$check$;

commit;
