-- 0168 — the agents get the whole platform
--
-- USER REPORT, 2026-09-03: "the agents still not working well ... i want them
-- to be like that with the access to the whole platform, they need to be alive
-- inside the platform ... the assistant is already do what agents are doing."
--
-- The last sentence is the diagnosis, and it was exactly right. An agent run
-- is the ordinary assistant run plus a persona and MINUS whatever its `tools`
-- array leaves out — `allowedTools` can only narrow. 0163 seeded both agents
-- with the four transcript tools that existed that day, so when 0167 added
-- `list_members` the assistant learned it and Roya and Ava did not.
--
-- The result is the complaint, precisely: ask the assistant "who is in my
-- organization" and it answers; ask @ava the same thing and she cannot, while
-- being introduced as the one who reads and reports. An agent that is strictly
-- weaker than the thing it is offered as an alternative to has no reason to
-- exist, and nothing anywhere said so — a narrowing list is silent about what
-- it is narrowing away.
--
-- What agents were NOT missing, checked before changing anything: the
-- client-executed tools (navigate, start/stop recording, rename, archive,
-- roles, member messages) sit OUTSIDE the ceiling in runtime.ts — `offered =
-- [...filtered domain tools, ...clientTools]` — so an agent has always been
-- able to ACT on the platform. It is the reading half that was short.
--
-- The narrowing feature stays, because it is right for an agent somebody
-- builds for one job. What changes is the seed: the two agents the PRODUCT
-- ships carry every read tool the platform has, and a standing test compares
-- that list against the code's own registry, so the next tool to land cannot
-- reach the assistant and quietly miss them.

begin;

update echo.assistant_agent
   set tools = '["search_transcripts", "read_window", "get_call",
                 "list_related_calls", "list_members"]'::jsonb,
       updated_at = now()
 where level = 'system'
   and handle in ('roya', 'ava')
   and archived_at is null;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_bad text;
begin
  -- both agents, and the same list: two system colleagues with different read
  -- reach would be a difference a person experiences and cannot explain
  select string_agg(handle || ' -> ' || tools::text, '; ' order by handle)
    into v_bad
    from echo.assistant_agent
   where level = 'system' and archived_at is null
     and not (tools @> '["list_members"]'::jsonb);
  if v_bad is not null then
    raise exception 'CHECK FAILED: a system agent still cannot read the roster: %', v_bad;
  end if;

  if (select count(distinct tools) from echo.assistant_agent
       where level = 'system' and archived_at is null) <> 1 then
    raise exception 'CHECK FAILED: the system agents do not carry the same read tools';
  end if;

  -- and the ceiling is still a ceiling: an EMPTY list would also satisfy
  -- "contains no tool I forbade", so assert the count rather than the absence
  if (select jsonb_array_length(tools) from echo.assistant_agent
       where level = 'system' and handle = 'roya' and archived_at is null) <> 5 then
    raise exception 'CHECK FAILED: roya does not carry exactly the five read tools';
  end if;
end $chk$;

commit;
