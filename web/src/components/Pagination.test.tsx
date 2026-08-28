import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PAGE_SIZE, Pagination, pageWindow, usePaged } from "./Pagination";

/**
 * The house table rule (user directive, 2026-08-27): ten rows, then numbered
 * pages under the table. Three of these assertions are about what the pager
 * must NOT do — a pager is easy to render and easy to get subtly wrong in
 * ways that look fine on a screenshot.
 */

describe("pageWindow", () => {
  it("draws every page while they fit", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first, the last and the current page's neighbours", () => {
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    /* at the edges the window does not leave a gap next to page 1 — a "…"
       hiding a single number is longer than the number */
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
  });
});

describe("Pagination", () => {
  it("renders NOTHING for a single page", () => {
    /* a lone "1" reads as a control that does not work, and a pager under a
       five-row table answers a question nobody asked */
    const { container } = render(
      <Pagination page={1} pageCount={1} onPage={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("numbers the pages in the locale's digits and reports the current one", () => {
    render(<Pagination page={2} pageCount={3} onPage={() => {}} />);
    /* the setup's locale is fa: Latin digits here would be the ss01 bug's
       shape — a number rendered in the wrong script on a Persian-first screen */
    expect(screen.getByText("۱")).toBeTruthy();
    expect(screen.getByText("۳")).toBeTruthy();
    expect(screen.getByText("۲").getAttribute("aria-current")).toBe("page");
  });

  it("moves by number and by step, and refuses to step past the ends", () => {
    const onPage = vi.fn();
    const { rerender } = render(<Pagination page={1} pageCount={3} onPage={onPage} />);

    fireEvent.click(screen.getByText("۳"));
    expect(onPage).toHaveBeenCalledWith(3);

    /* previous is dead on the first page — a control that fires and changes
       nothing teaches people the control is broken */
    const previous = screen.getAllByRole("button")[0] as HTMLButtonElement;
    expect(previous.disabled).toBe(true);

    rerender(<Pagination page={3} pageCount={3} onPage={onPage} />);
    const buttons = screen.getAllByRole("button");
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });
});

/** A probe: the hook's behaviour is only observable through a render. */
function Probe({ count }: { count: number }) {
  const rows = Array.from({ length: count }, (_, index) => `row-${index + 1}`);
  const { page, setPage, pageCount, visible } = usePaged(rows);
  return (
    <div>
      <p data-testid="state">{`${page}/${pageCount}/${visible.length}`}</p>
      <p data-testid="first">{visible[0] ?? "—"}</p>
      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
    </div>
  );
}

describe("usePaged", () => {
  it("shows ten rows first, and the remainder on the next page", () => {
    expect(PAGE_SIZE).toBe(10);
    render(<Probe count={25} />);
    expect(screen.getByTestId("state").textContent).toBe("1/3/10");
    expect(screen.getByTestId("first").textContent).toBe("row-1");

    fireEvent.click(screen.getByText("۳"));
    expect(screen.getByTestId("state").textContent).toBe("3/3/5");
    expect(screen.getByTestId("first").textContent).toBe("row-21");
  });

  it("clamps to the last page that exists when the rows shrink", () => {
    /* the bug this prevents: filter a list while standing on page 4 and the
       table renders empty under a page number — indistinguishable on screen
       from "no results", and only one of those is true */
    const { rerender } = render(<Probe count={25} />);
    fireEvent.click(screen.getByText("۳"));
    expect(screen.getByTestId("state").textContent).toBe("3/3/5");

    rerender(<Probe count={4} />);
    expect(screen.getByTestId("state").textContent).toBe("1/1/4");
    expect(screen.getByTestId("first").textContent).toBe("row-1");
  });
});
