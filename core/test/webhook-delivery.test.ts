/**
 * Delivery against a REAL local server, and the guard refusing real addresses.
 *
 * The SSRF behaviour is the point of this file: a webhook is a URL an org admin
 * chooses and we fetch from inside the deployment network, with the status code
 * read back through the admin UI. So the assertions that matter are the ones
 * about where we can be induced to connect.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import { classifyStatus, deliver } from "../src/worker/webhook-delivery.ts";

describe("status classification", () => {
  it("treats 2xx as delivered", () => {
    for (const status of [200, 201, 202, 204]) {
      expect(classifyStatus(status)).toMatchObject({ delivered: true, retryable: false });
    }
  });

  it("retries the statuses that mean 'try later'", () => {
    // 408/429 and every 5xx: the endpoint exists and is struggling.
    for (const status of [408, 429, 500, 502, 503]) {
      expect(classifyStatus(status)).toMatchObject({ delivered: false, retryable: true });
    }
  });

  it("does NOT retry a permanent 4xx", () => {
    // A 401 will still be a 401 in four minutes. Retrying wastes attempts and
    // delays the honest "this endpoint is misconfigured".
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(classifyStatus(status)).toMatchObject({ delivered: false, retryable: false });
    }
  });
});

describe("the address guard, as the dispatcher uses it", () => {
  it("refuses a plaintext http URL without connecting", async () => {
    const outcome = await deliver({ url: "http://example.com/hook", body: "{}", headers: {} });
    expect(outcome).toMatchObject({ reason: "blocked_address", retryable: false, status: null });
  });

  it("refuses a literal private address", async () => {
    const outcome = await deliver({ url: "https://10.0.0.5/hook", body: "{}", headers: {} });
    expect(outcome).toMatchObject({ reason: "blocked_address", retryable: false });
  });

  it("refuses the cloud metadata service", async () => {
    // The single highest-value SSRF target there is: it answers unauthenticated
    // GETs with credentials.
    const outcome = await deliver({ url: "https://169.254.169.254/latest/meta-data/", body: "{}", headers: {} });
    expect(outcome).toMatchObject({ reason: "blocked_address", retryable: false });
  });

  it("refuses a URL carrying credentials", async () => {
    const outcome = await deliver({ url: "https://user:pw@example.com/hook", body: "{}", headers: {} });
    expect(outcome).toMatchObject({ reason: "blocked_address", retryable: false });
  });

  it("NEVER marks a blocked address retryable", async () => {
    // The guard's own reasoning: it will be blocked again, and retrying turns
    // one refusal into a slow scan of the internal network. This is the single
    // assertion that keeps the dispatcher from becoming a scanning tool.
    for (const url of [
      "https://127.0.0.1/hook",
      "https://192.168.1.1/hook",
      "https://[::1]/hook",
      "https://169.254.169.254/",
    ]) {
      const outcome = await deliver({ url, body: "{}", headers: {} });
      expect(outcome.retryable, `${url} must not be retryable`).toBe(false);
    }
  });
});

// A real HTTP server, to prove the transport does what the classification says.
// It is plain http on loopback, so the guard refuses it — which is itself the
// proof that the guard is wired into the path rather than sitting beside it.
describe("the transport is genuinely guarded", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200).end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses to reach a loopback server that is demonstrably up", async () => {
    // The server below answers 200 to anything. If the guard were absent or
    // merely advisory, this returns delivered:true — so a passing assertion
    // here is evidence the refusal happens BEFORE the socket, not after.
    const outcome = await deliver({ url: `https://127.0.0.1:${port}/hook`, body: "{}", headers: {} });
    expect(outcome).toMatchObject({ delivered: false, reason: "blocked_address" });
  });
});
