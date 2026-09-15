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

const { SummaryTab } = await import("./Summary");

/**
 * THE SUMMARY IS IN THE DOCUMENT — on screen AND in the file (user report,
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
  title: "جلسهٔ هفتگی", host_name: "رؤیا", call_id: "c1",
  /* db/0202's roster — a colleague with an ACCOUNT. The document read
     `invitees` alone until 2026-09-07, so every member of every meeting was
     missing from its own minutes while the host stood there by themselves. */
  attendees: [{
    user_id: "u2", display_name: "سینا سپاسی", display_name_en: "Sina Sepasi",
    username: "sina", attended: true,
  }],
  /* and `invitees` still holds the one case it was written for: somebody
     with no account here */
  invitees: ["آوا"],
});

/** the last version is the current one — the ladder appends, never rewrites */
const version = (n: number, body: string) => ({
  id: `s${n}`, version: n, body, created_at: "2026-09-03T10:00:00.000Z",
  model: "test", agent_run_id: null,
});

function renderTab(callId: string | null) {
  return render(
    <SummaryTab meeting={MEETING} callId={callId} />,
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

describe("the summary tab carries the summary", () => {
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

  /*
   * WHO WAS THERE, from the roster the platform actually keeps (db/0202).
   * The pair is the point: a document that listed only the host passed every
   * other assertion in this file, and the ACCOUNT half is the one that was
   * missing for five days.
   */
  it("names the host, the members and anybody without an account — on screen and in the file", async () => {
    renderTab("c1");
    await screen.findByText("رؤیا");
    /* the member, resolved through personName from the wire — not a string
       somebody typed into invitees */
    expect(screen.getByText("سینا سپاسی")).toBeInTheDocument();
    expect(screen.getByText("آوا")).toBeInTheDocument();

    const html = await savedDocument();
    expect(html).toContain("سینا سپاسی");
    expect(html).toContain("آوا");
    expect(html).toContain("رؤیا");
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

  it("renders the models' markdown as a document, on screen and in the export", async () => {
    /* The models write a small markdown dialect and this tab used to print it:
       «**Next steps**» and «* Refresh the demo data» arrived on the product's
       most-read page as literal punctuation, and went into the Word file the
       same way. `SummaryBody` is the parser for that dialect and the call page
       has used it since 2026-08-24; this surface had never been moved onto it.

       Both halves are asserted because either alone passes against a broken
       version: the screen could be fixed while the download still writes
       asterisks, which is the half nobody looks at until a customer opens it. */
    getSummaries.mockResolvedValue([version(1, [
      "**Next steps**",
      "* Refresh the Harbor Bank demo data",
      "* Send the pricing proposal",
    ].join("\n"))]);
    renderTab("c1");

    // the heading is a heading and the asterisks are GONE from the page
    await waitFor(() => expect(screen.getByText("Next steps")).toBeTruthy());
    expect(screen.queryByText(/\*\*Next steps\*\*/)).toBeNull();
    expect(screen.getByText("Refresh the Harbor Bank demo data")).toBeTruthy();

    // …and the exported document carries structure, not the raw dialect
    const html = await savedDocument();
    expect(html).toContain("<h3>Next steps</h3>");
    expect(html).toContain("<li>Refresh the Harbor Bank demo data</li>");
    expect(html).not.toContain("**Next steps**");
    expect(html).not.toContain("<p>* Refresh");
  });
});
