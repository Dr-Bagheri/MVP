import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import { forgetLetterhead } from "@/lib/minutesFile";

/** the reader's language, movable: the exported document follows it, and the
    version that hardcoded `dir="rtl" lang="fa"` passed every fa assertion */
let LOCALE = "fa";
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => LOCALE,
}));

const getSummaries = vi.fn();
const meetingItems = vi.fn();
const org = vi.fn();
const me = vi.fn();
const composeMinutesText = vi.fn();
const meetingSignatures = vi.fn();
const signMeeting = vi.fn();
const withdrawMeetingSignature = vi.fn();
/*
 * EVERY METHOD THE COMPONENT CALLS. A mock that omits one does not fake «this
 * organisation has no letterhead» — it THROWS, inside a promise, and the
 * failure arrives as whatever rendered last. That is how seven tests in this
 * file went red at once for a reason none of them was about.
 */
vi.mock("@/api/client", () => ({
  api: {
    getSummaries: (...a: unknown[]) => getSummaries(...a),
    meetingItems: (...a: unknown[]) => meetingItems(...a),
    org: (...a: unknown[]) => org(...a),
    me: (...a: unknown[]) => me(...a),
    composeMinutesText: (...a: unknown[]) => composeMinutesText(...a),
    orgSheetUrl: () => "/api/org/sheet",
    meetingSignatures: (...a: unknown[]) => meetingSignatures(...a),
    signMeeting: (...a: unknown[]) => signMeeting(...a),
    withdrawMeetingSignature: (...a: unknown[]) => withdrawMeetingSignature(...a),
    meetingSignatureImageUrl: (m: string, u: string) => `/api/meetings/${m}/signatures/${u}/image`,
  },
  BffError: class extends Error {
    constructor(readonly status: number, readonly kind?: string, readonly detail?: string, readonly code?: string) { super("bff"); }
  },
}));

/** nobody has signed and the reader is not in the room — the ordinary
    fixture for every test that is not about signing */
const NOBODY_SIGNED = { signatures: [], can_sign: false, has_signature_on_file: false, signed: false };

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

/**
 * The document as `downloadWord` actually writes it.
 *
 * Word lives inside the ⋯ now (2026-09-17), so the errand is two presses. A
 * Radix trigger opens on POINTERDOWN, which `fireEvent.click` does not send —
 * `userEvent` is the only driver that reaches this menu, a fact this repo
 * paid sixteen red tests to learn when the menus moved onto Radix.
 */
async function savedDocument(): Promise<string> {
  const parts: unknown[] = [];
  const RealBlob = globalThis.Blob;
  vi.stubGlobal("Blob", class {
    constructor(bits: unknown[]) { parts.push(...bits); }
  });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Word/ }));
  vi.stubGlobal("Blob", RealBlob);
  return parts.filter((p) => typeof p === "string").join("");
}

describe("the summary tab carries the summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    LOCALE = "fa";
    meetingItems.mockResolvedValue([]);
    org.mockResolvedValue({ id: "o1", name: "شرکت" });
    me.mockResolvedValue({ id: "u1", role: "member" });
    meetingSignatures.mockResolvedValue(NOBODY_SIGNED);
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

/**
 * THE DOCUMENT'S OWN ROW, AND THE FILE IT HANDS OVER (user directive,
 * 2026-09-17).
 *
 * Two halves, and the second is the one no screen assertion can see: what
 * the exported file IS. «if not uploaded just go as simple but still with
 * structure related to regulations of companies and organizations back in
 * iran» — so the file is a صورت‌جلسه: an identified document, the roster,
 * the agenda, the account, numbered clauses, an assignment table naming who
 * and by when, and a place to sign.
 */
describe("the document's row, and the shape it exports (2026-09-17)", () => {
  const action = (over: Record<string, unknown> = {}) => ({
    id: "i1", kind: "action", body: "دادهٔ نمونه را تازه کن", source: "ai",
    done: false, owner: null, at_ms: null, owner_id: null, due_on: null,
    supersedes_id: null, status: "open", ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    LOCALE = "fa";
    meetingItems.mockResolvedValue([]);
    org.mockResolvedValue({ id: "o1", name: "شرکت" });
    me.mockResolvedValue({ id: "u1", role: "member" });
    getSummaries.mockResolvedValue([]);
    meetingSignatures.mockResolvedValue(NOBODY_SIGNED);
  });

  it("puts the name, the date and the controls in the DOCUMENT'S OWN box", async () => {
    /*
     * The second directive of the day, reversing the first: "add the items of
     * name of the meeting with date and buttons to the place of the
     * summarization, not separate like this — they have to be in the same
     * box". A header floating above the thing it names is a second box for
     * one document.
     */
    renderTab("c1");
    await screen.findByText("رؤیا");

    const card = screen.getByLabelText("tabSummary");
    const title = within(card).getByRole("heading", { name: "summaryDocTitle" });
    /* ONE row INSIDE the card: the title, the date under it, the controls at
       the other end. If any of the three were outside the article, this is
       the assertion that fails. */
    expect(within(card).getByRole("button", { name: "summaryExport" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "rerun" })).toBeTruthy();
    expect(within(card).getByText(/minutesDate/)).toBeTruthy();
    const row = title.closest("header")!;
    expect(within(row).getByRole("button", { name: "summaryExport" })).toBeTruthy();
    /* and said ONCE — the row above the card and this one would be two */
    expect(screen.getAllByRole("heading", { name: "summaryDocTitle" })).toHaveLength(1);
  });

  it("reads name-then-controls, so Persian puts the name at the start and the ⋯ at the far end", async () => {
    /*
     * "change their place with each other: the kebab menu left, then the
     * generate button, and the name and date on the right in the fa version."
     *
     * Asserted as DOCUMENT ORDER, not as a class: this is plain logical
     * order — no `rtl:flex-row-reverse` any more — so in Persian the first
     * child sits at the right and the last lands at the far left, and English
     * mirrors it into the header an English reader expects. A class assertion
     * could not tell those two arrangements apart.
     */
    renderTab("c1");
    await screen.findByText("رؤیا");
    const row = screen.getByRole("heading", { name: "summaryDocTitle" }).closest("header")!;
    const title = within(row).getByRole("heading", { name: "summaryDocTitle" });
    const rerun = within(row).getByRole("button", { name: "rerun" });
    const kebab = within(row).getByRole("button", { name: "summaryExport" });

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, rerun)).toBe(true);
    expect(follows(rerun, kebab)).toBe(true);
    /*
     * AND NOTHING REORDERS IT VISUALLY. DOM order alone is not the claim: CSS
     * can put the name last while the markup still reads name-first, and the
     * verify-red said so — `order-last` on the title and `flex-row-reverse`
     * on the controls both came back GREEN against the three lines above.
     * This is the same hole the live take's row had this morning, found the
     * same way: a mutation that changes what a reader sees and nothing else.
     */
    for (const el of [row, ...row.querySelectorAll("*")]) {
      /* the ATTRIBUTE, not `.className`: on the icons' <svg> that property is
         an SVGAnimatedString and `toMatch` throws on it — which is how this
         loop announced itself the first time it ran */
      expect(el.getAttribute("class") ?? "", `${el.tagName} reorders the row visually`)
        .not.toMatch(/\b(flex-row-reverse|order-(first|last|none|\d+))\b/);
    }
  });

  it("holds the two exports in the ⋯ and leaves «تولید دوباره» outside it", async () => {
    renderTab("c1");
    await screen.findByText("رؤیا");

    /* outside, in the row, where the directive put it */
    const rerun = screen.getByRole("button", { name: "rerun" });
    expect(rerun).toBeTruthy();
    /* and NOT as bare buttons beside it: the pair that stood here is the
       thing that moved */
    expect(screen.queryByRole("button", { name: /^Word$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^PDF$/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: /Word/ })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: /PDF/ })).toBeTruthy();
    /* the regenerate did not come along — a menu holding it too would be two
       doors to one act */
    expect(menu.queryByRole("menuitem", { name: "rerun" })).toBeNull();
  });

  it("exports a صورت‌جلسه: an identity block, the agenda, and a place to sign", async () => {
    renderTab("c1");
    await screen.findByText("رؤیا");
    const html = await savedDocument();

    expect(html).toContain("minutesDocKind");
    /* the document IDENTIFIES itself — number, date, hour, how it was held */
    expect(html).toContain("minutesNumber");
    expect(html).toContain(`MTG-${MEETING.id.slice(0, 8)}`);
    expect(html).toContain("fieldTime");
    expect(html).toContain("mode_online");
    expect(html).toContain("fieldAgenda");
    /* the roster signs it — and the names are the roster's, not invented */
    expect(html).toContain("minutesSignatures");
    expect(html).toContain("class=\"sign\"");
    expect(html).toContain("@page");
    /* AND IT CARRIES ITS OWN PAPER. `printPdf` writes into a window the reader
       sees before the print dialog covers it; with the ground left to the
       browser, a dark-mode reader met the whole document as near-black on
       near-black — while the printed page would have been perfect. Caught in a
       screenshot, pinned here. */
    expect(html).toContain("background: #fff");
    expect(html).toContain("color-scheme: light");
  });

  it("leaves out what the record does not hold, rather than printing it empty", async () => {
    /* «محل برگزاری: —» claims the place was asked for and left blank, which
       for an online meeting is simply untrue. The PAIR is the assertion: a
       meeting WITH a location must still print the row, or "never prints it"
       passes this too. */
    renderTab("c1");
    await screen.findByText("رؤیا");
    expect(await savedDocument()).not.toContain("fieldLocation");

    /* the SAME screen, re-rendered — two trees in one document would give the
       helper two ⋯ buttons to choose between, and it would pick the first */
    cleanup();
    const withPlace = meetingFixture({ ...MEETING, location: "اتاق جلسات ۲" });
    render(<SummaryTab meeting={withPlace} callId="c1" />);
    await screen.findByText("رؤیا");
    const html = await savedDocument();
    expect(html).toContain("fieldLocation");
    expect(html).toContain("اتاق جلسات ۲");
  });

  it("gives an action its owner and its deadline, in columns", async () => {
    meetingItems.mockResolvedValue([
      action({ owner: "سینا سپاسی", due_on: "2026-10-02" }),
      action({ id: "i2", body: "پیش‌نویس قرارداد", owner: null, due_on: null }),
    ]);
    renderTab("c1");
    await screen.findByText(/دادهٔ نمونه/);

    const html = await savedDocument();
    expect(html).toContain("minutesOwner");
    expect(html).toContain("minutesDue");
    expect(html).toContain("سینا سپاسی");
    /* the DAY as the reader's calendar renders it — never the raw column,
       and never the UTC-midnight reading that prints the day before */
    expect(html).not.toContain("2026-10-02");
    expect(html).toMatch(/۱۴۰۵|۱۰ مهر|مهر/);
    /* an unowned action is a dash in the table, not a missing row */
    expect(html).toContain("پیش‌نویس قرارداد");
    expect(html).toContain("—");
  });

  it("numbers the clauses in the document's own digits", async () => {
    meetingItems.mockResolvedValue([
      { ...action({ id: "d1", body: "قرارداد تمدید شود" }), kind: "decision" },
    ]);
    renderTab("c1");
    await screen.findByText("قرارداد تمدید شود");

    const html = await savedDocument();
    /* «1. قرارداد…» in a Persian document, beside Persian numerals on the
       screen it was exported from (M9: digits follow the language) */
    expect(html).toContain("۱. قرارداد تمدید شود");
    expect(html).not.toContain("<p>1. قرارداد");
  });

  it("writes the document in the reader's own language and direction", async () => {
    LOCALE = "en";
    renderTab("c1");
    await screen.findByText("رؤیا");
    const html = await savedDocument();
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).not.toContain('dir="rtl"');
  });
});

/**
 * THE COMPANY SHEET AND THE ASSISTANT'S DRAFT (user directive, 2026-09-17:
 * "in kebab menu add a option to upload company sheet file … and when they do
 * it and ask for pdf and word all the information in summarization must be
 * fit inside it. use the agent to do it as well").
 */
describe("the letterhead, and the assistant's draft (2026-09-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    LOCALE = "fa";
    meetingItems.mockResolvedValue([]);
    getSummaries.mockResolvedValue([]);
    org.mockResolvedValue({ id: "o1", name: "شرکت" });
    me.mockResolvedValue({ id: "u1", role: "member" });
    meetingSignatures.mockResolvedValue(NOBODY_SIGNED);
    forgetLetterhead();
  });

  it("offers the letterhead to an ADMIN and not to a colleague", async () => {
    /* the pair is the assertion. The upload is `org.settings` on the server
       (db/0228 + the admin route), and a row drawn for a member is a promise
       the product will not keep — pressing it would meet a refusal that
       explains nothing. */
    me.mockResolvedValue({ id: "u1", role: "member" });
    renderTab("c1");
    await screen.findByText("رؤیا");
    await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "sheetUpload" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    cleanup();
    me.mockResolvedValue({ id: "u1", role: "admin" });
    renderTab("c1");
    await screen.findByText("رؤیا");
    await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "sheetUpload" })).toBeTruthy();
  });

  it("prints the minutes on the organisation's paper, with the clear area it measured", async () => {
    org.mockResolvedValue({
      id: "o1", name: "شرکت",
      sheet: {
        mime: "image/png", source_mime: "application/pdf",
        top_mm: 52, bottom_mm: 30, side_mm: 22,
      },
    });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, {
      headers: { "content-type": "image/png" },
    })));

    renderTab("c1");
    await screen.findByText("رؤیا");
    const html = await savedDocument();

    /* the WORD button writes an MHTML ARCHIVE when there is a letterhead —
       measured against Word 16, which renders an image on every page from a
       named part and from nothing else (minutesDocument.ts carries the two
       shapes that failed first) */
    expect(html.startsWith("\ufeffMIME-Version: 1.0")).toBe(true);
    expect(html).toContain("Content-Location: file:///C:/neurai/minutes/letterhead.png");
    /* the image ITSELF travelled: a document that linked to /api/org/sheet
       reaches Word with nothing to show */
    expect(html).not.toContain("/api/org/sheet");
    expect(html).toContain("Content-Type: image/png");
  });

  it("falls back to plain paper when the letterhead cannot be fetched", async () => {
    /* a document on plain paper IS the document. Refusing to export because
       a decoration did not load trades the feature for the sheet. */
    org.mockResolvedValue({
      id: "o1", name: "شرکت",
      sheet: { mime: "image/png", source_mime: "image/png", top_mm: 52, bottom_mm: 30, side_mm: 22 },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    renderTab("c1");
    await screen.findByText("رؤیا");
    const html = await savedDocument();
    expect(html).not.toContain('class="sheet"');
    expect(html).toContain("minutesDocKind");
  });

  it("puts the assistant's draft in the EDITOR, never straight into the file", async () => {
    composeMinutesText.mockResolvedValue({ body: "در این جلسه دربارهٔ بودجه گفت‌وگو شد.", words: 240 });
    renderTab("c1");
    await screen.findByText("رؤیا");

    await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "minutesCompose" }));

    /* a model's paragraph goes into a document people sign only after
       somebody has read it and pressed save — so it lands in the textarea,
       and `editSummary` is not called by this press */
    await waitFor(() => expect(
      (screen.getByRole("textbox", { name: "minutesSummary" }) as HTMLTextAreaElement).value,
    ).toContain("بودجه"));
    expect(screen.getByText("minutesComposed")).toBeTruthy();
  });

  it("names WHICH nothing when the draft cannot be written", async () => {
    /* a provider that refused is not a meeting with nothing to say, and
       neither is a meeting nobody has recorded yet — the route distinguishes
       them and so does the line under the button */
    composeMinutesText.mockResolvedValue({ body: null, words: 0, reason: "nothing_to_compose" });
    renderTab("c1");
    await screen.findByText("رؤیا");
    await userEvent.click(screen.getByRole("button", { name: "summaryExport" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "minutesCompose" }));
    await waitFor(() => expect(screen.getByText("minutesComposeEmpty")).toBeTruthy());
    expect(screen.queryByText("minutesComposeFailed")).toBeNull();
  });
});

/**
 * THE SIGNATURES AT THE FOOT OF THE DOCUMENT (user directive, 2026-09-17:
 * "add place at the end of the summary that each attendant can add their own
 * signature there … and when the host is printing it, all of their real
 * signatures that were uploaded in jpg or png are already added there").
 */
describe("the signatures at the foot of the document (db/0229)", () => {
  const SINA = {
    user_id: "u2", display_name: "سینا سپاسی", display_name_en: "Sina Sepasi",
    username: "sina", mime: "image/png", signed_at: "2026-09-17T10:00:00.000Z",
  };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  beforeEach(() => {
    vi.clearAllMocks();
    LOCALE = "fa";
    meetingItems.mockResolvedValue([]);
    getSummaries.mockResolvedValue([]);
    org.mockResolvedValue({ id: "o1", name: "شرکت" });
    me.mockResolvedValue({ id: "u1", role: "member" });
    forgetLetterhead();
  });

  it("lists who signed, and draws the sign control only for somebody in the room", async () => {
    /* THE PAIR. A reader who was not in the meeting sees the list and no
       control — db/0229's policy would refuse them, and a button that meets
       a refusal explains nothing. A reader on the roster with a signature on
       file gets the one press. */
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, signatures: [SINA] });
    renderTab("c1");
    const foot = await screen.findByRole("region", { name: "minutesSignatures" });
    await within(foot).findByText("سینا سپاسی");
    expect(within(foot).queryByRole("button", { name: "signMinutes" })).toBeNull();
    expect(within(foot).queryByRole("button", { name: "signMinutesUpload" })).toBeNull();

    cleanup();
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: true });
    renderTab("c1");
    const mine = await screen.findByRole("region", { name: "minutesSignatures" });
    expect(await within(mine).findByRole("button", { name: "signMinutes" })).toBeTruthy();
    /* nobody yet, said as which nothing */
    expect(within(mine).getByText("signaturesNone")).toBeTruthy();
  });

  it("signs with the signature on file in one press, and the list follows the server's answer", async () => {
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: true });
    const ME = { ...SINA, user_id: "u1", display_name: "رؤیا" };
    signMeeting.mockResolvedValue({ signatures: [ME], can_sign: true, has_signature_on_file: true, signed: true });
    renderTab("c1");
    await userEvent.click(await screen.findByRole("button", { name: "signMinutes" }));

    /* no picture in the request: the one on file is what lands */
    expect(signMeeting).toHaveBeenCalledWith(MEETING.id, undefined);
    const foot = screen.getByRole("region", { name: "minutesSignatures" });
    /* the SERVER's record is adopted — the row, and the control flipping to
       withdraw — rather than this tab assuming the write landed */
    await within(foot).findByRole("button", { name: "signatureWithdraw" });
    expect(within(foot).getByText("signedByYou")).toBeTruthy();
    expect(within(foot).queryByRole("button", { name: "signMinutes" })).toBeNull();
    expect(within(foot).getByText("رؤیا")).toBeTruthy();
  });

  it("takes a picture right there when nothing is on file, and files and signs in ONE request", async () => {
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: false });
    signMeeting.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: true, signed: true });
    /* the deriving step ends in a canvas jsdom does not paint */
    vi.stubGlobal("createImageBitmap", async () => ({ width: 300, height: 90, close: () => {} }));
    const proto = globalThis.HTMLCanvasElement.prototype as unknown as { getContext: unknown; toDataURL: unknown };
    proto.getContext = () => ({ drawImage: () => {} });
    proto.toDataURL = () => "data:image/png;base64,U0lH";

    renderTab("c1");
    const foot = await screen.findByRole("region", { name: "minutesSignatures" });
    /* the upload door, not the plain sign: there is nothing on file to sign
       with, and a button that would meet `no_signature_on_file` is the
       refusal this branch exists to pre-empt */
    expect(await within(foot).findByRole("button", { name: "signMinutesUpload" })).toBeTruthy();
    expect(within(foot).queryByRole("button", { name: "signMinutes" })).toBeNull();

    const input = within(foot).getByLabelText("signMinutesUpload") as HTMLInputElement;
    await userEvent.upload(input, new File([PNG], "sig.png", { type: "image/png" }));
    await waitFor(() => expect(signMeeting).toHaveBeenCalledWith(MEETING.id, "U0lH"));
    await within(foot).findByRole("button", { name: "signatureWithdraw" });
  });

  it("takes a signature back on the reader's own press, and adopts the server's answer", async () => {
    const ME = { ...SINA, user_id: "u1", display_name: "رؤیا" };
    meetingSignatures.mockResolvedValue({ signatures: [ME], can_sign: true, has_signature_on_file: true, signed: true });
    withdrawMeetingSignature.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: true });
    renderTab("c1");
    await userEvent.click(await screen.findByRole("button", { name: "signatureWithdraw" }));
    expect(withdrawMeetingSignature).toHaveBeenCalledWith(MEETING.id);
    const foot = screen.getByRole("region", { name: "minutesSignatures" });
    await within(foot).findByRole("button", { name: "signMinutes" });
    expect(within(foot).queryByText("رؤیا")).toBeNull();
    expect(within(foot).getByText("signaturesNone")).toBeTruthy();
  });

  it("names WHICH nothing when signing is refused", async () => {
    /* "you have no signature on file" is fixable in the profile; "you
       already signed" is the primary key; both must not arrive as the
       generic "try again", which sends somebody to press the same button */
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, can_sign: true, has_signature_on_file: true });
    const { BffError } = await import("@/api/client");
    signMeeting.mockRejectedValue(new BffError(409, "conflict", undefined, "already_signed"));
    renderTab("c1");
    await userEvent.click(await screen.findByRole("button", { name: "signMinutes" }));
    await screen.findByText("sign_already_signed");
    expect(screen.queryByText("signFailed")).toBeNull();
  });

  it("prints every placed signature into the exported document, in its signer's row", async () => {
    /* the half no screen assertion can see, and the whole point of the
       directive: the picture is fetched FRESH at export and inlined in the
       row of the person it belongs to — matched by ACCOUNT, which is how the
       roster keys a member, never by name */
    meetingSignatures.mockResolvedValue({ ...NOBODY_SIGNED, signatures: [SINA] });
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }));
    renderTab("c1");
    await screen.findByText("رؤیا");
    const html = await savedDocument();

    expect(fetched).toContain(`/api/meetings/${MEETING.id}/signatures/u2/image`);
    expect(html).toContain(`<th>سینا سپاسی</th><td><img class="autograph" height="53" src="data:image/png;base64,`);
    /* the host, who has not signed, keeps a blank line to sign by hand */
    expect(html).toContain("<th>رؤیا</th><td></td>");
    /* and the guest without an account, likewise */
    expect(html).toContain("<th>آوا</th><td></td>");
    expect(html.match(/class="autograph"/g)).toHaveLength(1);
  });

  it("re-reads the signatures at export rather than printing the list the tab loaded with", async () => {
    /* the one report this feature must never produce: "the host printed it
       and mine was not on it". The tab loaded with nobody signed; by the
       time the ⋯ is pressed, a colleague has. */
    meetingSignatures
      .mockResolvedValueOnce(NOBODY_SIGNED)
      .mockResolvedValueOnce({ ...NOBODY_SIGNED, signatures: [SINA] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } })));
    renderTab("c1");
    const foot = await screen.findByRole("region", { name: "minutesSignatures" });
    await within(foot).findByText("signaturesNone");
    const html = await savedDocument();
    expect(meetingSignatures).toHaveBeenCalledTimes(2);
    expect(html).toContain(`<th>سینا سپاسی</th><td><img class="autograph"`);
  });
});
