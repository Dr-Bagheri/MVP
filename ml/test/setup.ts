// No network and no keys in the unit suite: the lanes are stubbed, and a test
// that reaches the internet is a test that fails in CI for the wrong reason.
// The live Persian smoke lives in test/smoke/ and is run by hand.

process.env.ML_LOG_LEVEL ??= "silent";
delete process.env.SONIOX_API_KEY;
delete process.env.OPENROUTER_API_KEY;
