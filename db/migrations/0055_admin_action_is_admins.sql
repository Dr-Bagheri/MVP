-- Echo — 0055: the audit table's integrity stops resting on its callers.
--
-- `admin_action_insert` admitted any ACTIVE member — self-attributed, with no
-- read-back, so a member could only ever write a truthful line about
-- themselves. That is why it looked harmless. But every call site being
-- admin-gated is a property of core/, not of the wall, and today's own
-- distilled finding is that **a decision enforced at a layer the write can be
-- routed around is a preference, not a rule** (D27). A table named
-- admin_action, read only by admins, should not depend on the api remembering
-- who it lets near the insert.
--
-- Tightened to admin-or-owner actors, through the one definition of that
-- (role_is_admin, 0037) rather than a fourth restatement of it.

drop policy admin_action_insert on echo.admin_action;

create policy admin_action_insert on echo.admin_action for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and actor_id = echo.actor_id()
    and echo.actor_is_admin()
  );

-- ---------------------------------------------------------------------------
-- What this makes visible, flagged rather than quietly accepted.
--
-- M11 says human deletions are "always logged", and members delete their own
-- calls. After this policy a member cannot write an audit line at all — which
-- is correct for a table called admin_action, read by admins, holding admin
-- decisions. It also means **a member soft-deleting their own call is recorded
-- nowhere**, and that was already true before this migration: nothing has ever
-- written an audit line for it.
--
-- So this narrows a policy without narrowing what is actually logged. But it
-- turns an unnoticed gap into a visible one, and the gap is M11's, not this
-- table's: either member deletions belong on a member-visible surface of their
-- own (as proposal_decision did for member decisions), or `soft_delete_call`
-- should write here as the definer and the name stops being true again.
--
-- Not decided here. Recorded so the next person meets a question rather than
-- an absence.
-- ---------------------------------------------------------------------------
