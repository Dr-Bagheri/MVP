import { describe, expect, it } from "vitest";

import { ProviderRefusal } from "../src/api/connector-providers.ts";
import { pollFailureFields } from "../src/worker/poll-failure.ts";

/**
 * The line a poller writes when a round fails. On 2026-09-08 it read
 * `error_type: "TypeError"` and nothing else — twice, for two different
 * defects — so these pin what stands beside the word now, and the one thing
 * that must never stand beside it: the rest of a sentence that might quote a
 * person's mail.
 */
describe("what a poller logs when a round fails", () => {
  it("names the class AND the callee for a TypeError — the 2026-09-08 line, with something beside the word", () => {
    let thrown: unknown;
    try {
      (undefined as unknown as { providerCtx(): void }).providerCtx();
    } catch (error) {
      thrown = error;
    }
    const fields = pollFailureFields(thrown);
    expect(fields.error_type).toBe("TypeError");
    expect(fields.at).toBe("Cannot read properties of");
    expect(fields.cause_code).toBeUndefined();
  });

  it("carries undici's code for a failed fetch", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.telegram.org"), { code: "ENOTFOUND" }),
    });
    expect(pollFailureFields(error)).toEqual({ error_type: "TypeError", cause_code: "ENOTFOUND", at: "fetch failed" });
  });

  it("carries the provider's status for a refusal — a revoked token is not a crash", () => {
    const fields = pollFailureFields(new ProviderRefusal(401, "gmail messages.list"));
    expect(fields.error_type).toBe("ProviderRefusal");
    expect(fields.provider_status).toBe(401);
  });

  it("cuts the sentence at four words, so a quoted subject line never travels", () => {
    const fields = pollFailureFields(new Error("Invalid value for header Subject: «حقوق شهریور — محرمانه»"));
    expect(fields.at).toBe("Invalid value for header");
    expect(JSON.stringify(fields)).not.toMatch(/محرمانه|حقوق/);
  });

  it("says what a non-Error was, rather than throwing on it", () => {
    expect(pollFailureFields("boom")).toEqual({ error_type: "string" });
  });
});
