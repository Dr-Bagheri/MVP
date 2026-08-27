-- 0107 — M41 P1: the executor's two doors into existing walls.
--
-- Ships in the SAME push as its consumers (core's workflow-step handler and
-- the manual-trigger route) — a granted function with no caller is rule
-- 13½'s defect, which is why 0104 deliberately left this out.
--
-- ── 1. workflow_graph_for_run — the enumerated definer (D8) ─────────────
-- workflow_version's SELECT policy is ADMIN-ONLY (0104: instructions never
-- cross to members). But a run executes AS ITS OWNER — usually a member —
-- and the executor must read the program it is running. This door is that
-- read, scoped to the one shape that is safe: THE CALLER'S OWN RUN. It
-- returns the graph for a run the actor owns and nothing otherwise —
-- an admin reading a program uses the policy; a member reading a program
-- gets it only through a run that already belongs to them, which is the
-- moment the program stopped being a secret FROM them (its steps are about
-- to act on their data, as them).
--
-- ── 2. agent_card learns 'workflow_result' ──────────────────────────────
-- The notify step's card. 0074's check constraint enumerated two kinds;
-- widened rather than dropped — a closed set stays closed, it just grows.

begin;

create or replace function echo.workflow_graph_for_run(p_run uuid)
returns table (graph jsonb, agents jsonb, max_autonomy text, budget jsonb)
language sql
security definer
set search_path = ''
stable
as $$
  select v.graph, v.agents, v.max_autonomy, v.budget
    from echo.workflow_run r
    join echo.workflow_version v on v.id = r.workflow_version_id
   where r.id = p_run
     and r.owner_id = echo.actor_id()
     and r.org_id = echo.actor_org_id()
$$;

comment on function echo.workflow_graph_for_run(uuid) is
  'M41 P1 (D8-enumerated): the run-scoped program read. The executor runs as the run''s OWNER, who cannot pass workflow_version''s admin-only policy; this returns the graph for THE CALLER''S OWN RUN and nothing else.';

revoke all on function echo.workflow_graph_for_run(uuid) from public;
grant execute on function echo.workflow_graph_for_run(uuid) to echo_app;

-- the card kind — find the constraint by its definition, not a guessed
-- auto-name (a wrong guess here drops nothing and fails loudly, which is
-- the right failure)
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'echo.agent_card'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%post_call_brief%';
  if cname is null then
    raise exception 'agent_card kind constraint not found — 0074 drifted?';
  end if;
  execute format('alter table echo.agent_card drop constraint %I', cname);
  execute $ddl$
    alter table echo.agent_card
      add constraint agent_card_kind_check
      check (kind in ('post_call_brief', 'weekly_digest', 'workflow_result'))
  $ddl$;
end;
$$;

commit;
