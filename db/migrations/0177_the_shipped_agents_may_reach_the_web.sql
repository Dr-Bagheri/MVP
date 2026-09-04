-- 0177 — the shipped agents may reach the web
--
-- User report, 2026-09-04: "i gave them web access but it didn't add to the
-- page and to them."
--
-- Both halves of that sentence were true, and the cause is one fact with two
-- switches. Web access is `person.agents_web AND agent.web` — either off is
-- off — and db/0169 put the second one on the PERSON deliberately, because the
-- open web is the one capability here that spends money outside the building.
--
-- What the user turned on was the person's switch, in Settings · Assistant.
-- `assistant_agent.web` for رؤیا and آوا was seeded FALSE by 0163 and nothing
-- has ever offered a way to change it: system agents refuse PATCH outright
-- (their configuration is the product's), so the agent half of the AND was
-- unreachable from every surface. The switch the user pressed could not have
-- worked, and the page reported the OTHER flag, which is why it also looked
-- like nothing had happened.
--
-- ── THE DECISION ──────────────────────────────────────────────────────────
--
-- The agent flag goes TRUE for both, which makes the person's switch the only
-- control — which is what it reads as on screen, and what the user meant when
-- they turned it on. The AND survives and still means something: an
-- organisation's own agent can be authored with `web: false` and stay off the
-- web whatever its author allows, and that is the case the flag was for. What
-- it was never for was making a product-shipped agent permanently unable to do
-- something the product offers.
--
-- Echo is not here and needs nothing: it has no `assistant_agent` row, and its
-- web access has always been the person's switch alone.

begin;

update echo.assistant_agent
   set web = true
 where level = 'system'
   and handle in ('roya', 'ava')
   and web = false;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare
  v_off  int;
  v_seen int;
begin
  select count(*) into v_seen from echo.assistant_agent where level = 'system';
  if v_seen <> 2 then
    raise exception
      'CHECK FAILED: expected exactly two system agents, found % — this migration named them by hand and the roster has changed',
      v_seen;
  end if;

  select count(*) into v_off
    from echo.assistant_agent where level = 'system' and web = false;
  if v_off <> 0 then
    raise exception 'CHECK FAILED: % system agent(s) still cannot reach the web', v_off;
  end if;

  -- and NOTHING ELSE moved. An update with a `where` this narrow is easy to
  -- widen by accident, and an org's own agent silently gaining web access is
  -- exactly the kind of change nobody would notice until a bill arrived.
  if exists (
    select 1 from echo.assistant_agent
     where level <> 'system' and web = true
       and updated_at > now() - interval '1 minute'
  ) then
    raise exception 'CHECK FAILED: this migration touched an agent it does not own';
  end if;
end $chk$;

commit;
