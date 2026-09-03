import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

const getSummaries = vi.fn();
const meetingItems = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    getSummaries: (...a: unknown[]) => getSummaries(...a),
    meetingItems: (...a: unknown[]) => meetingItems(...a),
  },
}));

const { MinutesTab } = await import("./Minutes");

/**
 * THE SUMMARY IS IN THE MINUTES — on screen AND in the file (user report,
 * 2026-09-03: "summary is not included in Minutes of the meeting, add it
 * there and it most be added to the report it save also").
 *
 * The second half is why this file exists. A screen assertion cannot see the
 * exported document: `documentHtml()` is a separate string built from the same
 * state, and the version that renders the summary on screen and forgets it in
 * the file looks completely correct in the browser. That is the shape of every
 * two-consumers-one-fact defect in this repo, so the download is asserted
 * through the BLOB it actually writes.
 */
const MEETING = meetingFixture({
  title: "جلسهٔ هفتگی", host_name: "رؤیا", invitees: ["آوا"], call_id: "c1",
});

/** the last version is the current one — the ladder appends, never rewrites */
const version = (n: number, body: string) => ({
  id: `s${n}`, version: n, body, created_at: "2026-09-03T10:00:00.000Z",
  model: "test", agent_run_id: null,
});

function renderTab(callId: string | null) {
  return render(
    <MinutesTab meeting={MEETING} callId={callId} myName="رؤیا" myId="u1" onChanged={() => {}} />,
  );
}

/** the document as `downloadWord` actually writes it */
async function savedDocument(): Promise<string> {
  const parts: unknown[] = [];
  const RealBlob = globalThis.Blob;
  vi.stubGlobal("Blob", class {
    constructor(bits: unknown[]) { parts.push(...bits); }
  });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  screen.getByRole("button", { name: /Word/ }).click();
  vi.stubGlobal("Blob", RealBlob);
  return parts.filter((p) => typeof p === "string").join("");
}

describe("the minutes carry the summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    meetingItems.mockResolvedValue([]);
  });

  it("renders the summary's paragraphs on screen", async () => {
    getSummaries.mockResolvedValue([
      version(1, "نسخهٔ کهنه"),
      version(2, "بند نخست.\n\nبند دوم."),
    ]);
    renderTab("c1");
    /* anchored on the ARRIVED value, never on the section heading — the
       heading renders during the fetch too, so asserting it would pass
       against an implementation that never reads a summary at all */
    await waitFor(() => expect(screen.getByText("بند نخست.")).toBeTruthy());
    expect(screen.getByText("بند دوم.")).toBeTruthy();
    /* the CURRENT version, not the first one the wire happened to list */
    expect(screen.queryByText("نسخهٔ کهنه")).toBeNull();
  });

  it("writes the summary into the saved document", async () => {
    getSummaries.mockResolvedValue([version(1, "بند نخست.\n\nبند دوم.")]);
    renderTab("c1");
    await waitFor(() => expect(screen.getByText("بند نخست.")).toBeTruthy());

    const html = await savedDocument();
    expect(html).toContain("minutesSummary");
    expect(html).toContain("بند نخست.");
    expect(html).toContain("بند دوم.");
    /* and it lands where a reader expects it: after who was there, before
       what was decided.
       Presence is asserted FIRST, and that is not ceremony — `indexOf` returns
       -1 for a heading that is not in the document at all, and -1 is less than
       every real position, so an ordering assertion alone passes most loudly
       when the section it is ordering has gone missing. Found by a verify-red
       that went green: a botched probe deleted the ATTENDEES line instead of
       the summary's, and this ordering check reported the document fine. */
    for (const heading of ["minutesAttendees", "minutesSummary", "ext_decisions"]) {
      expect(html, heading).toContain(heading);
    }
    expect(html.indexOf("minutesAttendees")).toBeLessThan(html.indexOf("minutesSummary"));
    expect(html.indexOf("minutesSummary")).toBeLessThan(html.indexOf("ext_decisions"));
  });

  it("says so when there is no summary, in both places", async () => {
    /* a meeting with no recording at all — the ordinary state of a meeting
       nobody recorded, and the one a `callId!` would have crashed on */
    renderTab(null);
    await waitFor(() => expect(screen.getByText("minutesNoSummary")).toBeTruthy());
    expect(getSummaries).not.toHaveBeenCalled();
    expect(await savedDocument()).toContain("minutesNoSummary");
  });

  it("distinguishes a failed read from an empty one", async () => {
    /* rule 12: "we could not fetch it" must not be reported as "there isn't
       one" — the first is transient and worth retrying, the second is a fact
       about the meeting */
    getSummaries.mockRejectedValue(new Error("network"));
    renderTab("c1");
    await waitFor(() => expect(screen.getByText("minutesSummaryFailed")).toBeTruthy());
    expect(screen.queryByText("minutesNoSummary")).toBeNull();
  });

  it("escapes the summary into the document — it is model text", async () => {
    /* the same rule the rest of this document follows: everything written into
       that HTML string goes through esc(), model output included */
    getSummaries.mockResolvedValue([version(1, "<img src=x onerror=alert(1)>")]);
    renderTab("c1");
    await waitFor(() => expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy());
    const html = await savedDocument();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
