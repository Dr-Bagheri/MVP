/**
 * Every declared queue has a registered handler.
 *
 * The fourth rule-13½ instrument, and it exists because of what the first
 * three could not see. The webhook dispatcher (M17) was written, tested,
 * line-reviewed, given an SSRF connect-time guard and a replay-protected
 * signing scheme — and never added to `main.ts`'s handler list. The queue
 * `echo_deliver_webhook` therefore carried `total_messages = 0` for its
 * entire life. A drain created in Settings wrote its row, enqueued a
 * delivery, and waited forever.
 *
 * Nothing was red. Every suite was honest: the dispatcher's tests proved the
 * dispatcher, the enqueuer's tests proved the enqueuer, the schema proved the
 * queue existed. The failure lived in the space between them, which is
 * exactly where 13½ failures live.
 *
 * The existing instruments each watch ONE seam — granted-vs-called for
 * database functions, route-manifest for HTTP routes, table-consumed for
 * tables. A queue is a seam too, and it was the unwatched one. `createRunner`
 * already refuses TWO handlers claiming one queue; nobody had written the
 * symmetric half, and the symmetric half is the one that ships silently.
 *
 * ── how the coverage list is derived, and why not by hand ──────────────────
 * `ALL_QUEUES` is imported from the producer rather than restated here. A
 * hand-written list is itself a seam (the Role-drift lesson: the guard's own
 * coverage list drifted while guarding everything else), and a queue that
 * someone forgot to add to this file would be invisible in exactly the way
 * the bug was.
 *
 * The consumer side is read from source rather than from a second list, for
 * the same reason. It matches `queue: Q_NAME` — the form a real claim takes —
 * rather than the bare name, because the bare name appears in comments, in
 * the `ALL_QUEUES` array itself, and in log lines. That is the corpus-
 * discipline correction from the column tripwire, where a name-grep was
 * satisfied by the name's own presence in the code that failed to use it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALL_QUEUES } from "../src/worker/queue.ts";

const workerDir = fileURLToPath(new URL("../src/worker/", import.meta.url));
const read = (name: string) => readFileSync(workerDir + name, "utf8");

/**
 * The step factories `main.ts` actually passes to `createRunner`. Parsed from
 * the `handlers: [ … ]` argument rather than from the whole file: a factory
 * that is imported and never registered is precisely the defect, and an
 * import-scan would call it covered.
 */
function registeredFactories(): string[] {
  const main = read("main.ts");
  const open = main.indexOf("handlers: [");
  expect(open, "main.ts should pass a handlers array to createRunner").toBeGreaterThan(-1);

  let depth = 0;
  let end = -1;
  for (let i = main.indexOf("[", open); i < main.length; i += 1) {
    if (main[i] === "[") depth += 1;
    else if (main[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, "the handlers array should be closed").toBeGreaterThan(-1);

  const block = main.slice(open, end);
  return [...block.matchAll(/\bcreate(\w+Step)\s*\(/g)].map((m) => `create${m[1]}`);
}

/** queue constant → the factory that claims it, read from each module. */
function claimsByFactory(): Map<string, string> {
  const claims = new Map<string, string>();
  for (const file of ["steps.ts", "call-steps.ts", "signal-step.ts", "workflow-step.ts"]) {
    const src = read(file);
    /*
     * A module may hold more than one factory (call-steps.ts holds two), so
     * the claim is attributed to the factory whose body it falls inside —
     * the nearest preceding `export function createXStep`. Attributing by
     * file would let one registered factory vouch for an unregistered
     * sibling in the same file, which is the bug wearing a smaller hat.
     */
    const factories = [...src.matchAll(/export function (create\w+Step)\b/g)];
    for (const claim of src.matchAll(/^\s*queue: (Q_[A-Z_]+),/gm)) {
      const at = claim.index ?? 0;
      const owner = factories.filter((f) => (f.index ?? 0) < at).pop();
      expect(owner, `${file}: a queue claim with no factory above it`).toBeTruthy();
      claims.set(claim[1]!, owner![1]!);
    }
  }
  return claims;
}

/** `Q_SUMMARIZE` → `"echo_summarize"`, read from the producer's own source. */
function queueNames(): Map<string, string> {
  const src = read("queue.ts");
  const names = new Map<string, string>();
  for (const m of src.matchAll(/export const (Q_[A-Z_]+) = "([a-z_]+)";/g)) {
    names.set(m[1]!, m[2]!);
  }
  return names;
}

describe("every declared queue has a registered handler", () => {
  it("covers ALL_QUEUES, with no queue left waiting for a consumer", () => {
    const registered = new Set(registeredFactories());
    const claims = claimsByFactory();
    const names = queueNames();

    const handledQueueNames = new Set(
      [...claims].filter(([, factory]) => registered.has(factory)).map(([q]) => names.get(q)),
    );

    const orphans = ALL_QUEUES.filter((q) => !handledQueueNames.has(q));
    expect(
      orphans,
      `these queues are declared and nothing in main.ts consumes them: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  /*
   * The negative controls. Without these the test above is the vacuous kind:
   * every assertion it makes is "the thing I expect is present", and the
   * corrected rule is that such a check needs one question it should answer
   * NO to. Each control reconstructs the real defect from the real inputs and
   * demands the same computation fail.
   */
  it("FAILS when a queue is declared with no handler — the actual webhook bug", () => {
    const registered = new Set(registeredFactories());
    const claims = claimsByFactory();
    const names = queueNames();
    const handled = new Set(
      [...claims].filter(([, f]) => registered.has(f)).map(([q]) => names.get(q)),
    );

    // the shape of the thing that shipped: a queue in the inventory whose
    // handler was written but never registered
    const withGhost = [...ALL_QUEUES, "echo_deliver_webhook"];
    expect(withGhost.filter((q) => !handled.has(q))).toEqual(["echo_deliver_webhook"]);
  });

  it("FAILS when a registered handler is removed from main.ts", () => {
    const claims = claimsByFactory();
    const names = queueNames();
    // drop one real factory from the registered set, as deleting its line would
    const registered = new Set(registeredFactories());
    const dropped = [...registered][0]!;
    registered.delete(dropped);

    const handled = new Set(
      [...claims].filter(([, f]) => registered.has(f)).map(([q]) => names.get(q)),
    );
    const orphans = ALL_QUEUES.filter((q) => !handled.has(q));
    expect(orphans.length, `removing ${dropped} should orphan its queue`).toBeGreaterThan(0);
  });

  it("reads a real corpus — the parse found handlers, claims and names", () => {
    /*
     * The had-something-to-check assertion. If main.ts is refactored so the
     * handlers array no longer parses, every set above goes empty and the
     * first test passes by finding no orphans among nothing. Counts, not
     * truthiness, for the same reason.
     */
    expect(registeredFactories().length).toBeGreaterThanOrEqual(4);
    expect(claimsByFactory().size).toBeGreaterThanOrEqual(4);
    expect(queueNames().size).toBe(ALL_QUEUES.length);
  });
});
