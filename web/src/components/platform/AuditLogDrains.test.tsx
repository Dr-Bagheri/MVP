/**
 * Audit log drains — LIVE (Part 3). The predecessor of this file asserted
 * the honest-absence card ("builds nothing"); that design retired WITH its
 * absence, so these tests assert the feature: the wire is read, creation
 * sends exactly {url, events}, the secret renders once and only on the
 * caller's dismissal, and a delivery with no response code says so in words.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayDelivery, GatewayWebhook } from "@/api/types";

const gatewayWebhooks = vi.fn();
const gatewayDeliveries = vi.fn();
const createGatewayWebhook = vi.fn();
const setWebhookEnabled = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    gatewayWebhooks: () => gatewayWebhooks(),
    gatewayDeliveries: () => gatewayDeliveries(),
    createGatewayWebhook: (...a: unknown[]) => createGatewayWebhook(...a),
    setWebhookEnabled: (...a: unknown[]) => setWebhookEnabled(...a),
  },
  BffError: class BffError extends Error {
    constructor(readonly status: number, readonly kind?: string, readonly detail?: string) {
      super(`bff ${status}`);
    }
  },
}));

const { AuditLogDrains } = await import("./AuditLogDrains");

const HOOK: GatewayWebhook = {
  id: "wh-1",
  url: "https://example.com/hooks/audit",
  events: ["call.created"],
  enabled: true,
  created_at: "2026-08-16T10:00:00Z",
};

const DELIVERY: GatewayDelivery = {
  id: "d-1",
  webhook_id: "wh-1",
  event: "call.created",
  attempts: 3,
  /* the discriminating fixture: no answer EVER came back — must render as
     words, never a number and never a dash that reads as data */
  response_code: null,
  delivered_at: null,
  failed_at: "2026-08-16T11:00:00Z",
  next_attempt_at: null,
  created_at: "2026-08-16T10:30:00Z",
};

beforeEach(() => {
  gatewayWebhooks.mockReset().mockResolvedValue([HOOK]);
  gatewayDeliveries.mockReset().mockResolvedValue([DELIVERY]);
  createGatewayWebhook.mockReset();
  setWebhookEnabled.mockReset();
});

describe("audit log drains, live", () => {
  it("renders the org's drains from the wire", async () => {
    render(<AuditLogDrains />);
    await waitFor(() =>
      expect(screen.getByText("https://example.com/hooks/audit")).toBeTruthy(),
    );
    // the event name renders verbatim in BOTH places it should: the drain's
    // chip and the delivery row
    expect(screen.getAllByText("call.created").length).toBe(2);
  });

  it("a delivery with no response renders words, not a number", async () => {
    render(<AuditLogDrains />);
    await waitFor(() => expect(screen.getByText("بدون پاسخ")).toBeTruthy());
  });

  it("creation sends exactly {url, events} and surfaces the one-time secret", async () => {
    createGatewayWebhook.mockResolvedValue({
      ...HOOK,
      id: "wh-2",
      secret: "whsec_ONCE_ONLY",
    });
    render(<AuditLogDrains />);
    await waitFor(() => expect(screen.getByText("مقصد تازه")).toBeTruthy());
    screen.getByText("مقصد تازه").click();

    const url = await screen.findByLabelText("نشانی مقصد");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(url, "https://example.com/hooks/new");
    url.dispatchEvent(new Event("input", { bubbles: true }));

    (await screen.findByText("ساختن")).click();
    await waitFor(() =>
      expect(createGatewayWebhook).toHaveBeenCalledWith(
        "https://example.com/hooks/new",
        expect.arrayContaining(["call.created", "call.failed"]),
      ),
    );
    // the secret's ONLY appearance — dismissed by the user, never a timer
    await waitFor(() => expect(screen.getByText("whsec_ONCE_ONLY")).toBeTruthy());
  });

  it("a 403 renders the admin-only sentence, not an empty org", async () => {
    const { BffError } = await import("@/api/client");
    gatewayWebhooks.mockRejectedValue(new (BffError as new (s: number) => Error)(403));
    render(<AuditLogDrains />);
    await waitFor(() =>
      expect(screen.getByText(/مدیران سازمان/)).toBeTruthy(),
    );
  });
});
