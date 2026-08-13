/**
 * WEBHOOK DELIVERY — the address guard, against the real network.
 *
 * This harness exists because the guard has TWO layers and only one of them
 * can be reached without DNS:
 *
 *   `assertDeliverableUrl` is a string check. It rejects http, credentials,
 *   and an IP LITERAL in the host. It never resolves anything.
 *
 *   `guardedLookup` is the real control. It runs while the socket is opening,
 *   on the address actually being connected to, which is the only moment a
 *   rebinding attack has nothing left to swap.
 *
 * A test using `https://127.0.0.1/` exercises the first and says nothing about
 * the second — and the second is the one the design calls "THE control". The
 * case that separates them is a PUBLIC hostname that resolves to a private
 * address, which needs a real resolver to demonstrate. That is what this file
 * is for, and it is why it is not a unit test.
 *
 * Nothing is sent to anybody: every blocked case is refused before a socket is
 * connected, so the body never leaves the machine. The one request that does
 * go out goes to our own Supabase project.
 *
 *   SUPABASE_URL=… node --experimental-strip-types test/e2e/dispatcher-live.ts
 */
import { deliver } from "../../src/worker/webhook-delivery.ts";

const checks: [string, boolean, string | undefined][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);

/** A body shaped like a real one: identifiers and status ONLY (M17 invariant). */
const BODY = JSON.stringify({
  event: "call.ready",
  call_id: "00000000-0000-4000-8000-000000000000",
  org_id: "00000000-0000-4000-8000-00000000000d",
  status: "ready",
});

const HEADERS = {
  "echo-signature": "t=1786000000,v1=0000000000000000000000000000000000000000000000000000000000000000",
};

async function main(): Promise<void> {
  const send = (url: string) => deliver({ url, body: BODY, headers: HEADERS, timeoutMs: 8000 });

  // ------------------------------------------------------------------
  // [1] The string layer.
  // ------------------------------------------------------------------
  console.log("\n[1] refused before any lookup");
  for (const [label, url] of [
    ["a loopback literal", "https://127.0.0.1/hook"],
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["an RFC1918 literal", "https://10.0.0.5/hook"],
    ["IPv6 loopback", "https://[::1]/hook"],
    ["plain http", "http://example.com/hook"],
    ["credentials smuggled into the host", "https://user:pass@example.com/hook"],
  ] as const) {
    const outcome = await send(url);
    check(
      `${label} is refused, and NOT retryable`,
      outcome.reason === "blocked_address" && !outcome.retryable && !outcome.delivered,
      `${outcome.reason}${outcome.retryable ? " (retryable!)" : ""}`,
    );
  }

  // ------------------------------------------------------------------
  // [2] The layer that actually matters.
  //
  // `localtest.me` is a public name whose DNS answer is 127.0.0.1 — the shape
  // of every SSRF that gets past a URL parser. The string check sees a
  // perfectly ordinary hostname and passes it. Only `guardedLookup`, firing as
  // the socket opens, can catch this one.
  // ------------------------------------------------------------------
  console.log("[2] a PUBLIC hostname that resolves to loopback");
  const rebind = await send("https://localtest.me/hook");
  check(
    "a public name resolving to a private address is blocked at connect time",
    rebind.reason === "blocked_address" && !rebind.retryable && !rebind.delivered,
    `${rebind.reason} · status ${rebind.status}`,
  );
  check(
    "and it is reported as blocked, not as a transport failure",
    rebind.reason !== "transport_ECONNREFUSED" && !rebind.reason.startsWith("transport_"),
    // These look identical from the outside and mean opposite things: a
    // transport failure is retryable, and retrying a blocked address is how
    // one refusal becomes a slow scan of the internal network.
    rebind.reason,
  );

  // ------------------------------------------------------------------
  // [3] The positive control, and it is not optional.
  //
  // Every check above passes if delivery is simply broken — a guard that
  // refuses everything is indistinguishable from a guard that works, unless
  // something legitimate is shown to get through. This request reaches a real
  // public host over real TLS and comes back with a real status code.
  // ------------------------------------------------------------------
  console.log("[3] positive control — a legitimate public endpoint IS reached");
  const publicUrl = `${(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/echo-dispatcher-live-probe`;
  if (!process.env.SUPABASE_URL) {
    check("positive control ran", false, "SUPABASE_URL not set — every block above is unproven");
  } else {
    const real = await send(publicUrl);
    check(
      "a public endpoint is reached and answers with a status",
      real.status !== null && real.reason !== "blocked_address",
      `HTTP ${real.status} · ${real.reason}`,
    );
    // A 4xx that is not 408/429 is permanent: it will be the same 4xx in four
    // minutes, and retrying only delays the honest "this endpoint is wrong".
    check(
      "a permanent 4xx is classified as not retryable",
      real.status !== null && real.status >= 400 && real.status < 500 && real.status !== 408
        ? !real.retryable
        : true,
      `HTTP ${real.status} → retryable=${real.retryable}`,
    );
  }

  console.log("\n─── checks ───");
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(
    `\n${failed === 0 ? "DISPATCHER ADDRESS-GUARD ACCEPTANCE PASSED" : `FAILED (${failed})`}\n` +
      "NOT covered here: a successful 2xx delivery to a receiver that verifies\n" +
      "the signature. That needs a public endpoint we control; see the note to\n" +
      "the steward. Saying so beats a run that reports 'passed' and leaves the\n" +
      "delivered:true path unexecuted.\n",
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nharness failed:", (error as Error).message);
  process.exit(1);
});
