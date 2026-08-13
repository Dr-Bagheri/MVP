-- Echo — 0051: one signature again.
--
-- The api has moved to run_is_truncated(status, started_at) and nothing calls
-- the one-argument form, so it goes. It only ever existed to avoid pulling a
-- function out from under a running consumer (the echo_transcode discipline),
-- and that reason has expired.
--
-- Leaving it would be worse than untidy. Two functions of the same name, one
-- of them unexercised, is precisely the drift shape 0034 removed an unused
-- helper to avoid — and this pair is more dangerous than that one was, because
-- the two forms AGREE on every row that exists today. A future author calling
-- the shorter one would find it correct in testing and wrong only for runs
-- under an hour old, which is a state that exists for about an hour and never
-- when anyone is looking.

drop function echo.run_is_truncated(echo.agent_run_status);
