// A receiver we control, for proving the webhook 2xx leg end to end.
//
// WHY THIS EXISTS. The dispatcher's address guard blocks loopback and every
// private range with no dev escape hatch — correctly — so a local receiver is
// unreachable by construction, and nothing else of ours answers 200 to an
// anonymous POST. Without a public endpoint we own, `delivered:true`, the
// replay-protected signature travelling over a real wire, and
// `webhook_delivery.response_code` recording a success are all unexecuted. A
// third-party echo service would work and would also hand somebody else's
// server our org and call identifiers, so: our own project, our own function.
//
// The 401 side is not decoration. A receiver that answers 200 to everything
// makes the harness vacuous — it would pass just as happily against a
// dispatcher that signed nothing at all — which is why the harness sends a
// tampered delivery and requires the refusal.
//
// It stores nothing and logs no body. The body is identifiers and status only
// (M17), and it is still not this function's business.
//
// DEPLOY NOTE, and it matters: this must be deployed with `--no-verify-jwt`.
// Edge Functions demand a Supabase JWT by default, and a webhook sender has no
// reason to hold one — so without that flag every delivery is refused by the
// PLATFORM before this file runs, and the harness sees a 401 that looks
// exactly like our own signature check failing.
//
//   supabase functions deploy echo-webhook-probe --no-verify-jwt --project-ref <ref>
//   supabase secrets set ECHO_WEBHOOK_SECRET_SHA256=<digest> --project-ref <ref>

// NOTE ON TYPECHECKING. `verify.ts` is checked by core/'s tsc and covered by
// core/'s suite — it is plain WebCrypto and runs under both runtimes. This
// file is Deno glue, and it is checked too, against the ambient declarations
// in `deno-shim.d.ts`; that shim is a separate file precisely so it stays
// invisible to Deno, which would otherwise see its own globals redeclared.
// See the shim for what that does and does not prove.
import { verifyDelivery } from "./verify.ts";

const SECRET = Deno.env.get("ECHO_WEBHOOK_SECRET_SHA256") ?? "";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

  if (!SECRET) {
    // Refuse rather than accept. A receiver with no key that still answers 200
    // validates nothing and would report the harness green — the exact failure
    // this endpoint exists to make impossible.
    return new Response("receiver not configured", { status: 500 });
  }

  // The RAW text, before any parsing. Verifying a re-serialised body checks a
  // string we produced rather than the one that arrived — key order alone
  // would break it, and it would break in the direction that says "valid".
  const body = await request.text();
  const result = await verifyDelivery(SECRET, body, request.headers.get("echo-signature") ?? "");

  if (result !== "ok") {
    // The reason is returned so a failing harness run says WHICH way it failed
    // — a malformed header, an out-of-tolerance timestamp and a bad MAC are
    // three different bugs and one status code.
    return new Response(JSON.stringify({ verified: false, reason: result }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ verified: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
