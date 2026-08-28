-- 0116 — a card for the reply waiting in the dock.
--
-- The fourth `agent_card` kind, and the first one whose conversation opens
-- onto something a person ACTS on rather than reads. 0107's pattern kept:
-- find the constraint by its definition, because a guessed auto-name drops
-- nothing and fails loudly, which is the right failure.
--
-- Also lands the drift 0107 left behind: `web/src/api/types.ts` never learned
-- `workflow_result` because nothing derives that union from a producer. The
-- vocabulary now exports AGENT_CARD_KINDS and the web guard compares against
-- it, so the next kind cannot arrive un-noticed the way this one's
-- predecessor did (rule 13½: derive the coverage list from the producer).

begin;

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
    raise exception 'agent_card kind constraint not found — 0074/0107 drifted?';
  end if;
  execute format('alter table echo.agent_card drop constraint %I', cname);
  execute $ddl$
    alter table echo.agent_card
      add constraint agent_card_kind_check
      check (kind in ('post_call_brief', 'weekly_digest', 'workflow_result', 'mail_draft'))
  $ddl$;
end;
$$;

commit;
