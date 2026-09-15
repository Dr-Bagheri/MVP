import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnswerContent } from "./AnswerBlocks";

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const fence = (json: string) => "```neurai-block\n" + json + "\n```";

describe("AnswerContent", () => {
  it("renders a checklist as ticks, not as the JSON the model wrote", () => {
    render(
      <AnswerContent
        text={fence('{"kind":"checklist","items":[{"text":"پیش‌نویس","done":true},{"text":"مهاجرت"}]}')}
      />,
    );
    expect(screen.getByText("پیش‌نویس")).toBeInTheDocument();
    expect(screen.getByText("مهاجرت")).toBeInTheDocument();
    /* the defect this whole module exists for: the fence's payload must not
       reach the reader as text */
    expect(screen.queryByText(/"kind"/)).toBeNull();
  });

  it("renders stats tiles with their figures", () => {
    render(
      <AnswerContent
        text={fence('{"kind":"stats","title":"این هفته","items":[{"label":"باز","value":"۱۲","hint":"۳ بحرانی"}]}')}
      />,
    );
    expect(screen.getByText("این هفته")).toBeInTheDocument();
    expect(screen.getByText("باز")).toBeInTheDocument();
    expect(screen.getByText("۱۲")).toBeInTheDocument();
    expect(screen.getByText("۳ بحرانی")).toBeInTheDocument();
  });

  it("scales a chart's bars against the LARGEST value, not against 100", () => {
    const { container } = render(
      <AnswerContent text={fence('{"kind":"chart","series":[{"label":"الف","value":3},{"label":"ب","value":6}]}')} />,
    );
    const bars = [...container.querySelectorAll<HTMLElement>("[style*='inline-size']")];
    expect(bars).toHaveLength(2);
    /* a fixed hundred would draw two slivers and say nothing */
    expect(bars[1]!.style.inlineSize).toBe("100%");
    expect(bars[0]!.style.inlineSize).toBe("50%");
  });

  it("a reference with a well-formed id is a LINK to the record", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    render(
      <AnswerContent text={fence(`{"kind":"refs","items":[{"kind":"call","id":"${id}","title":"جلسهٔ سه‌شنبه"}]}`)} />,
    );
    expect(screen.getByRole("link", { name: /جلسهٔ سه‌شنبه/ })).toHaveAttribute(
      "href",
      `/calls/${id}`,
    );
  });

  it("a reference the model could not address is a chip, never a link into nowhere", () => {
    render(
      <AnswerContent text={fence('{"kind":"refs","items":[{"kind":"call","id":"probably-a-guess","title":"جلسهٔ سه‌شنبه"}]}')} />,
    );
    expect(screen.getByText("جلسهٔ سه‌شنبه")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a table's HEADINGS are the model's words, never [object Object]", () => {
    /*
     * The rendered half of the 2026-09-09 report: the parser can hold the
     * right columns and a renderer could still print them wrong, so the
     * assertion is on the screen. The payload is the one production
     * produced — objects in `columns`, strings in `rows`, which is exactly
     * why the four headings read `[object Object]` over four correct rows.
     */
    const { container } = render(
      <AnswerContent
        text={fence(
          '{"kind":"table","columns":[{"header":"Task"},{"header":"Priority"},{"header":"Due Date"}],'
          + '"rows":[["Draft Q3 renewal terms","critical","2026-09-11"]]}',
        )}
      />,
    );
    expect([...container.querySelectorAll("th")].map((th) => th.textContent))
      .toEqual(["Task", "Priority", "Due Date"]);
    /* the symptom itself, asserted as an absence anywhere on the screen —
       the shipped version puts it in three cells and passes every assertion
       about the row below them */
    expect(container.textContent).not.toContain("[object Object]");
    expect(screen.getByText("Draft Q3 renewal terms")).toBeInTheDocument();
  });

  it("prose around a block still renders as markdown", () => {
    render(<AnswerContent text={`**سه نکته**\n\n${fence('{"kind":"checklist","items":["الف"]}')}\n\nبعد`} />);
    expect(screen.getByText("سه نکته").tagName).toBe("STRONG");
    expect(screen.getByText("بعد")).toBeInTheDocument();
  });
});

/**
 * THE GUARD, and it is the whole reason this module was extracted.
 *
 * The panel rendered `<Markdown>` alone while the Hub parsed blocks, so the
 * same answer came out as a checklist on one surface and as a wall of JSON in
 * a code fence on the other (2026-09-08). A second copy of the parse would
 * re-open that gap silently; a surface that renders an assistant answer must
 * go through this module.
 */
describe("both assistant surfaces render answers through one module", () => {
  const SRC = join(process.cwd(), "src", "components", "platform");
  const SURFACES = ["ConversationThread.tsx", "AssistantSidebar.tsx"];

  it.each(SURFACES)("%s imports AnswerContent", (file) => {
    expect(readFileSync(join(SRC, file), "utf8")).toContain('from "./AnswerBlocks"');
  });

  it.each(SURFACES)("%s does not render markdown itself", (file) => {
    /* the control: the bug was an import of the markdown renderer standing
       where the block-aware one belongs */
    expect(readFileSync(join(SRC, file), "utf8")).not.toContain('from "@/components/ui/markdown"');
  });
});

/*
 * A "When" column of `2026-09-09T13:22:47.105Z` (observed 2026-09-09).
 * The model copies an instant out of a tool result as it found it; the cell
 * is rendered as a date, and everything that is not an instant is not
 * touched — a table's cells are the model's own words everywhere else.
 */
describe("a date in a model-authored block", () => {
  it("renders an ISO instant in a table cell as a readable date, not the wire string", () => {
    render(
      <AnswerContent
        text={fence(
          '{"kind":"table","columns":["Title","When"],'
          + '"rows":[["Weekly meeting with NAI","2026-09-09T13:22:47.105Z"]]}',
        )}
      />,
    );
    expect(screen.getByText("Weekly meeting with NAI")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-09T13:22:47.105Z")).toBeNull();
    /* the month is NAMED and the clock is the reader's — which calendar it is
       named in follows the surface's locale, so the assertion allows either */
    expect(screen.getByText(/شهریور|Sep/)).toBeInTheDocument();
  });

  it("leaves a cell that is not an instant exactly as the model wrote it", () => {
    render(
      <AnswerContent
        text={fence('{"kind":"table","columns":["Q"],"rows":[["2026-09-09"]]}')}
      />,
    );
    expect(screen.getByText("2026-09-09")).toBeInTheDocument();
  });
});
