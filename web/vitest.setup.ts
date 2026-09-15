import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * THE ASSISTANT'S CONVERSATION IS MODULE STATE, ON PURPOSE.
 *
 * `lib/assistantSession` holds the thread and the running stream outside React
 * so a run survives the screen it started on — which is the whole point, and
 * which also means it survives a TEST. Left alone, one file's in-flight stream
 * writes into the next file's first assertion; `lib/liveConversation` already
 * documents that exact symptom ("expected 'sess-live-1' to be undefined" on an
 * ask that had not happened yet), and it was mocked away there rather than
 * closed.
 *
 * Central rather than per-file, for the same reason as the stub above: it bites
 * every test that renders either assistant surface, and a reset each author has
 * to rediscover is a tax paid repeatedly for one fact about the store. It
 * ABORTS anything running, which is what actually stops the late write.
 */
beforeEach(async () => {
  /*
   * IMPORTED HERE, NOT AT THE TOP, and the difference is not style.
   *
   * A static import in a setup file instantiates the module — and everything
   * it imports — BEFORE any test file's `vi.mock` is registered. The store
   * imports `@/api/client`, so the top-level version bound the REAL client
   * while the suite under test was driving a scripted mock: every ask went to
   * a fetch nobody had stubbed, and the symptom was `expected +0 to be 1` on
   * a call count, which reads as "the component did not ask" rather than "the
   * component asked the wrong module". A dynamic import inside the hook runs
   * after the mocks are in place and returns the same instance the test file
   * already loaded.
   */
  const { resetAssistantForTest } = await import("@/lib/assistantSession");
  resetAssistantForTest();
});

/**
 * jsdom has no `scrollIntoView`, and unstubbed it THROWS inside an effect —
 * which takes the whole render down and surfaces as "element not found".
 * That reads as a missing feature rather than a missing browser API, so the
 * next person debugs their component instead of their environment.
 *
 * Central rather than per-file: it bites every component test that scrolls,
 * and a stub each author has to rediscover is a tax paid repeatedly for one
 * fact about jsdom.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* no-op: jsdom does not lay out, so there is nothing to scroll */
  };
}

/**
 * next-intl reads a request-scoped config that doesn't exist under jsdom, so
 * components are tested against the REAL message files with the key path
 * returned verbatim when a key is missing.
 *
 * That last part is deliberate: a stub returning the key for everything would
 * make a test pass while the string was absent — the same "renders identically
 * to its absence" failure we keep finding in the product. Here a missing key
 * shows up as a literal `assistant.foo` in the assertion.
 */
import fa from "./src/messages/fa.json";

/**
 * `unknown` leaves, not `string`: next-intl namespaces may NEST, and
 * `settings.*` does (`group.configuration`, `section.general`, …). The narrower
 * type made the real `fa.json` uncastable the moment a nested namespace landed.
 */
type Messages = Record<string, Record<string, unknown>>;

/**
 * Resolve a dotted key path, returning a string or `undefined`.
 *
 * Nesting has to be walked rather than looked up flat, or `t("group.general")`
 * misses and reports itself as missing — which would be the harness lying in
 * the *safe* direction, but lying: the string is present and the test says it
 * isn't. Anything that resolves to a non-string is treated as a miss too, since
 * rendering `[object Object]` is not a pass.
 */
function resolve(table: Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>(
    (node, part) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
    table,
  );
  return typeof value === "string" ? value : undefined;
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const table = (fa as Messages)[namespace] ?? {};
    const t = (key: string, values?: Record<string, string | number>) => {
      const raw = resolve(table, key);
      if (raw === undefined) return `${namespace}.${key}`;
      return values
        ? Object.entries(values).reduce(
            (out, [name, value]) => out.replace(`{${name}}`, String(value)),
            raw,
          )
        : raw;
    };
    /*
     * ONE LOOKUP FOR BOTH `raw` AND `has`, so they cannot disagree about
     * whether a key exists. Two spellings of "is it there" is how a fake
     * starts answering a question differently from the library it stands in
     * for.
     */
    const lookup = (key: string): { found: boolean; value: unknown } => {
      const value = key.split(".").reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        table,
      );
      return { found: value !== undefined, value };
    };
    /**
     * `t.raw` mirrors next-intl's: the message VALUE untouched, whatever its
     * type — it is how array-valued messages (starter questions) are read.
     *
     * **IT DOES NOT THROW, and the comment that used to say it did was the
     * bug (review F15).** That sentence — "throws on a miss exactly as the
     * real one does" — was a belief about somebody else's library, written
     * into our harness, and wrong. Read in the installed runtime
     * (`use-intl@4.13.7 …/development/initializeConfig-CUsOI8u2.js`):
     * `translateFn.raw` wraps `resolvePath` in a `try` and on failure calls
     * `getFallbackFromErrorAndNotify(key, MISSING_MESSAGE, error.message)`,
     * which reports through `onError` — `console.error` by default — and
     * RETURNS `getMessageFallback`, i.e. the dotted key path. Nothing is
     * thrown, in the shipped bytes.
     *
     * That difference is not cosmetic: the defect F15 is about lives on the
     * console channel, and a fake that throws produces no console output for
     * a spy to observe. With the throwing version in place the assertion
     * could not be *written*, let alone fail.
     */
    t.raw = (key: string): unknown => {
      const { found, value } = lookup(key);
      if (found) return value;
      /* the real sentence, verbatim from `initializeConfig-*.js:53` plus the
         IntlError code prefix — this is what a person sees in the console */
      console.error(
        `MISSING_MESSAGE: Could not resolve \`${namespace}.${key}\` in messages for locale \`fa\`.`,
      );
      return `${namespace}.${key}`;
    };
    /**
     * `t.has` — resolves the same path and answers a boolean, reporting
     * NOTHING. Asking is silent; reading is not. That asymmetry is the whole
     * mechanism the fix depends on, so both sides of it live here.
     *
     * Confirmed present on the real translator in the INSTALLED version
     * (`dist/types/core/createBaseTranslator.d.ts:20 — has(key: string):
     * boolean`), not in the changelog. If it were absent, every test here
     * would pass while every render in production threw `t.has is not a
     * function` — the fake deciding what nothing means, reintroduced by the
     * fix for exactly that.
     */
    t.has = (key: string): boolean => lookup(key).found;
    return t;
  },
  useLocale: () => "fa",
}));

/**
 * THE TOAST STACK IS MOUNTED FOR EVERY TEST, because it is mounted for every
 * SCREEN (2026-09-08).
 *
 * Messages left their surfaces on that date: a refused write used to draw its
 * own red line inside the component under test, and now it calls `notify()`
 * and `components/platform/Toaster` draws it — once, above every route, from
 * the locale layout. A component test that renders only the component is
 * therefore testing a screen that cannot say anything, and twenty assertions
 * of the form "the refusal is visible" would have had to be rewritten into
 * assertions about a module's internal history array.
 *
 * That rewrite was the wrong fix. Those tests are right about the product —
 * the person IS told — and the only thing that changed is which element says
 * so. Mounting the real Toaster here keeps them asking the question they were
 * written to ask, against the real component, through the real bus.
 *
 * CENTRAL, for the reason every other stub in this file is: it is true of
 * every test that renders a surface, and a mount each author has to remember
 * is one each author will forget.
 *
 * IT IS NOT RENDERED THROUGH TESTING LIBRARY, and that is the whole trick.
 * A dozen suites open with `beforeEach(() => cleanup())`, and a test file's
 * hooks run AFTER the setup file's — so a Toaster rendered with `render()`
 * was mounted and then immediately torn down by the suite's own first line,
 * every time, in every one of those files. Its container is created here and
 * owned here; RTL's `cleanup` only unmounts what RTL mounted, so this one
 * survives the suites that clear the screen before each test. It is unmounted
 * in `afterEach` — which clears the timers inside it, and stops one test's
 * toast being found by the next test's `findByRole("alert")`.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

let toasterRoot: Root | null = null;
let toasterHost: HTMLElement | null = null;

beforeEach(async () => {
  /*
   * A FILE THAT MOCKS THE BUS AWAY HAS OPTED OUT.
   *
   * Several suites replace `@/lib/notify` with a partial mock — usually a
   * `notifyError` spy and nothing else — because what they are testing is
   * that the component RAISED the notice, not that a stack drew it. The
   * Toaster subscribes on mount, so under those mocks it would call a
   * `subscribeNotify` the mock does not define and take the whole render
   * down with it, turning "this suite mocks the bus" into thirty failures
   * that read as broken components.
   *
   * It is a `try`, not an `if`, because a Vitest module mock THROWS on a
   * property it was not given rather than answering `undefined` — reading
   * `bus.subscribeNotify` to see whether it exists is itself the failure.
   */
  let live = false;
  try {
    const bus = await import("@/lib/notify");
    live = typeof bus.subscribeNotify === "function";
    /*
     * AND THE BUS STARTS EMPTY, which is not tidiness either.
     *
     * `notify()` collapses a repeat of the same sentence inside an 8-second
     * window into the notice already raised — the fix for one dead
     * connection drawing «ذخیره نشد» four times. Its memory is the history
     * array, which is module state, which the whole file shares: without
     * this, a suite that refuses a write in two tests has the SECOND one
     * arrive as a repeat of the first — same id, count of two, and a card
     * whose text now carries a «×۲» that the assertion does not expect.
     * A dedupe window is shared state between tests until somebody empties
     * it.
     */
    if (live) bus.clearNotifications();
  } catch {
    live = false;
  }
  if (!live) return;
  const { Toaster } = await import("@/components/platform/Toaster");
  toasterHost = document.createElement("div");
  document.body.appendChild(toasterHost);
  toasterRoot = createRoot(toasterHost);
  act(() => {
    toasterRoot!.render(createElement(Toaster));
  });
});

afterEach(() => {
  if (toasterRoot === null) return;
  const root = toasterRoot;
  act(() => { root.unmount(); });
  toasterHost?.remove();
  toasterRoot = null;
  toasterHost = null;
});
