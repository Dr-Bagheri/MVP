// Minimal ambient declarations so Node's tsc can check `index.ts`.
//
// WHY A SEPARATE FILE. Declaring these inside index.ts would satisfy Node and
// then REDECLARE Deno's own globals under Deno's checker at deploy. An ambient
// .d.ts is invisible to Deno — it only compiles what the entry module actually
// imports — so this exists for one runtime and not the other, which is the
// only way both can be happy.
//
// WHY IT EXISTS AT ALL. Without it, `index.ts` is the single file in this
// package that nothing checks, and the first thing to discover a typo in it
// would be a failed deploy. The Deno runtime is not available on this machine,
// so this is the closest honest substitute.
//
// WHAT IT DOES NOT PROVE, stated plainly: these signatures are my reading of
// Deno's documented API, not Deno's real types. They catch syntax errors,
// typos, and misuse of `verify.ts` — the realistic failure modes for thirty
// lines of glue. They cannot catch a signature that Deno defines differently.
// Replace this with `deno check` the moment a Deno toolchain is on the box.

declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
