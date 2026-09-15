import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

/**
 * The renderer's four promises, and one of them is a wall.
 *
 * Everything here is about the OUTPUT rather than the class strings: the
 * whole reason this component exists is that the model's structure was
 * arriving as punctuation, and "the string contains `<strong>`" is a fact
 * about a template, not about what a reader sees.
 */
describe("markdown, rendered", () => {
  it("renders the structure a model actually writes", () => {
    const { container } = render(
      <Markdown
        content={[
          "### سه نکته",
          "",
          "- **نخست** یک",
          "- دوم دو",
          "",
          "| ستون | وضعیت |",
          "| --- | --- |",
          "| الف | باز |",
          "",
          "```ts",
          "const x = 1;",
          "```",
        ].join("\n")}
      />,
    );

    /* the heading is stepped DOWN — an answer inside a thread may not outrank
       the page, so `###` is an <h4> and never an <h3> of its own */
    expect(container.querySelector("h4")?.textContent).toBe("سه نکته");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("li > strong")?.textContent).toBe("نخست");
    /* remark-gfm's half: a pipe table is a table, not a row of pipes */
    expect(container.querySelector("table th")?.textContent).toBe("ستون");
    expect(container.querySelector("table td")?.textContent).toBe("الف");
    expect(container.querySelector("pre > code")?.textContent).toContain("const x = 1;");
  });

  /**
   * THE WALL. Model output is untrusted and reaches every reader of a thread,
   * so a `<script>` or a form in an answer must be text. No `rehype-raw`,
   * and this is the assertion that says so — verified red by adding it.
   */
  it("never renders raw HTML from an answer", () => {
    const { container } = render(
      <Markdown content={'<script>window.x=1</script><img src="x" onerror="alert(1)">'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("window.x=1");
  });

  it("opens a link in its own tab and hands the page nothing", () => {
    render(<Markdown content="[سند](https://example.com/a)" />);
    const link = screen.getByRole("link", { name: "سند" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  /*
   * A `javascript:` href is react-markdown's own transform, not ours — but it
   * is a property this product depends on, so it is asserted here rather than
   * assumed of a dependency.
   */
  it("refuses a javascript: link", () => {
    const { container } = render(<Markdown content="[بزن](javascript:alert(1))" />);
    /* the transform drops the href entirely, so the anchor is not even a LINK
       to the accessibility tree — queried by tag for exactly that reason */
    const anchor = container.querySelector("a")!;
    expect(anchor.textContent).toBe("بزن");
    expect(anchor.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  /**
   * A remote image in an answer is a beacon: it reports who read what and
   * when, to whoever influenced the model's output, the moment the message
   * paints. The address is SHOWN and the reader chooses.
   */
  it("shows a remote image as a link instead of fetching it", () => {
    const { container } = render(<Markdown content="![نمودار](https://tracker.example/p.png)" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "نمودار" })).toHaveAttribute(
      "href",
      "https://tracker.example/p.png",
    );
  });

  /**
   * The streaming promise, as the two frames a stream actually produces.
   *
   * **This assertion was written the other way round and the test corrected
   * it.** I expected an unclosed fence to render as a paragraph until its
   * closing line arrived — it does not: CommonMark runs an unterminated fence
   * to the end of the document, so the block appears with the FIRST fence and
   * only grows. That is the better behaviour for a stream (a code block does
   * not flicker into existence three lines late) and it is asserted rather
   * than assumed, because it is a promise of the parser and not of this file.
   *
   * The prose before it stays prose in both frames, which is the half that
   * would catch a fence swallowing the answer around it.
   */
  it("renders a fence as a block from its opening line, closed or not", () => {
    const open = render(<Markdown content={"شرح:\n\n```ts\nconst x"} />);
    expect(open.container.querySelector("pre > code")?.textContent).toContain("const x");
    expect(open.container.querySelector("p")?.textContent).toBe("شرح:");
    open.unmount();

    const closed = render(<Markdown content={"شرح:\n\n```ts\nconst x = 1;\n```"} />);
    expect(closed.container.querySelector("pre > code")?.textContent).toContain("const x = 1;");
    expect(closed.container.querySelector("p")?.textContent).toBe("شرح:");
  });

  /**
   * The two seams the thread depends on: `contents` on the wrapper, so the
   * paragraphs join the message's own block flow rather than sitting in a box
   * inside it, and an inline first paragraph so the speaker's name keeps the
   * answer's opening words on its line.
   */
  it("passes the caller's class to the wrapper", () => {
    const { container } = render(
      <Markdown content="سلام" className="contents [&>p:first-child]:inline" />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("contents");
    expect(wrapper.className).toContain("[&>p:first-child]:inline");
    expect(wrapper.querySelector("p")?.textContent).toBe("سلام");
  });
});
