-- ---------------------------------------------------------------------------
-- 0057 — a born-active founder has no acceptance stamp (companion to 0056).
--
-- 0002's constraint said: (status = 'pending') = (accepted_at is null) — an
-- iff written when every account passed through an acceptance. 0056 created a
-- row it structurally forbids: the founder who is ACTIVE at birth because the
-- confirmed email was the acceptance. The suite caught it on the first run,
-- which is the negative-space schema doing exactly its job.
--
-- The WRONG fix was to stamp founders accepted_at=now(), accepted_by=NULL:
-- accepted_by NULL is the vendor's signature (80_vendor_acceptance asserts
-- it), so that would forge a vendor acceptance that never happened — two
-- different histories rendered indistinguishable, the kinds-of-nothing
-- failure written into the table.
--
-- New semantics, all three states distinct and enforced:
--   pending                      → no stamps at all
--   active/disabled, stamped     → an acceptance happened (accepted_by names
--                                  the admin; NULL = the vendor)
--   active/disabled, stampless   → born active under 0056; the record of the
--                                  gate is the auth email confirmation
-- ---------------------------------------------------------------------------

alter table echo.app_user
  drop constraint app_user_accepted_consistent;

alter table echo.app_user
  add constraint app_user_accepted_consistent
  check (
    case when status = 'pending'
         then accepted_at is null and accepted_by is null
         -- a signer without a timestamp is half a record, never legal
         else accepted_by is null or accepted_at is not null
    end
  );

comment on constraint app_user_accepted_consistent on echo.app_user is
  'Pending rows carry no acceptance stamps. Non-pending rows may be stamped '
  '(an acceptance happened; accepted_by NULL = the vendor) or stampless '
  '(born active under 0056 — email confirmation was the gate).';
