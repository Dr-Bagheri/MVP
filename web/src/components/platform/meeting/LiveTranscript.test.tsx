import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CaptionRow } from "@/lib/captionRows";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars === undefined ? key : `${key}:${Object.values(vars).join(",")}`,
  useLocale: () => "fa",
}));

const { LiveTranscript } = await import("./LiveTranscript");

/**
 * THE TRANSCRIPT WHILE IT IS STILL BEING MADE.
 *
 * The contract facts, in the order they matter:
 *
 *  1. WHICH NOTHING. "the take has not started", "the lane refused" and "it
 *     is listening and has heard nothing" are three different sentences —
 *     one word for all three would tell a person to wait for something that
 *     is never coming (rule 12).
 *  2. A LABEL IS NOT A NAME until there is enough behind it. The provider
 *     guesses while it listens, and `establishedSpeakers` is the bar; a row
 *     under it renders with no badge, because the words were said and stay
 *     but we do not claim they were somebody else.
 *  3. THE INTERIM IS NOT A ROW: unstamped and muted, because the provider
 *     revises it.
 */
const row = (over: Partial<CaptionRow> = {}): CaptionRow => ({
  atMs: 3_000, text: "خب، امروز دربارهٔ بودجه صحبت می‌کنیم.", ...over,
});

/** enough turns behind one label that `establishedSpeakers` will name it */
const established = (speaker: string, n = 4): CaptionRow[] =>
  Array.from({ length: n }, (_, i) =>
    row({ atMs: i * 5_000, speaker, text: `جملهٔ ${i} با متن به‌اندازهٔ کافی برای شمردن.` }));

describe("LiveTranscript", () => {
  it("names WHICH nothing it is in", () => {
    const view = render(
      <LiveTranscript rows={[]} interim="" speakers={[]} lane="off" locale="fa" />,
    );
    expect(screen.getByText("liveIdle")).toBeInTheDocument();

    view.rerender(<LiveTranscript rows={[]} interim="" speakers={[]} lane="down" locale="fa" />);
    expect(screen.getByText("liveUnavailable")).toBeInTheDocument();
    /* the discriminating pair: a version answering one word for every state
       satisfies either line above on its own */
    expect(screen.queryByText("liveIdle")).toBeNull();

    view.rerender(<LiveTranscript rows={[]} interim="" speakers={[]} lane="on" locale="fa" />);
    expect(screen.getByText("liveWaiting")).toBeInTheDocument();
    expect(screen.queryByText("liveUnavailable")).toBeNull();
  });

  it("draws each row with its own clock, and counts them", () => {
    render(
      <LiveTranscript
        rows={[row({ atMs: 5_000, text: "اول" }), row({ atMs: 65_000, text: "دوم" })]}
        interim="" speakers={[]} lane="on" locale="fa"
      />,
    );
    expect(screen.getByText("اول")).toBeInTheDocument();
    expect(screen.getByText("دوم")).toBeInTheDocument();
    /* the take's own clock, in the page's digits */
    expect(screen.getByText("۰:۰۵")).toBeInTheDocument();
    expect(screen.getByText("۱:۰۵")).toBeInTheDocument();
    expect(screen.getByText("transcriptCount:۲")).toBeInTheDocument();
  });

  it("names a voice only once there is enough behind its label", () => {
    const rows = [
      ...established("2"),
      /* ONE turn, a few words — the provider's guess, not yet a claim */
      row({ atMs: 90_000, speaker: "7", text: "آها." }),
    ];
    render(
      <LiveTranscript rows={rows} interim="" speakers={["2", "7"]} lane="on" locale="fa" />,
    );
    /* the established label is numbered by its POSITION among the voices we
       are willing to name — never by the provider's own string */
    expect(screen.getAllByText("speakerNamed:۱").length).toBeGreaterThan(0);
    expect(screen.queryByText("speakerNamed:۲")).toBeNull();
    expect(screen.queryByText("speakerNamed:۷")).toBeNull();
    /* and the thin one's WORDS are still there — this is about the badge,
       never about dropping what was said */
    expect(screen.getByText("آها.")).toBeInTheDocument();
  });

  it("shows the unfinalised fragment without a stamp", () => {
    render(
      <LiveTranscript
        rows={[row({ atMs: 5_000, text: "اول" })]}
        interim="و بعد" speakers={[]} lane="on" locale="fa"
      />,
    );
    const fragment = screen.getByText("و بعد");
    expect(fragment).toBeInTheDocument();
    /* NOT a stamped row: the moment it belongs to is not settled either, so
       a version that gave it the row treatment would be claiming a time */
    expect(within(fragment).queryByText("۰:۰۵")).toBeNull();
    expect(fragment.className).toContain("text-fg-muted");
  });
});
