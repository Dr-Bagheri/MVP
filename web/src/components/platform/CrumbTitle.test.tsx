import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CrumbTitleProvider, useCrumbTitle, useCrumbTitleValue } from "./CrumbTitle";

/**
 * **The bug this file exists for: the provider was in the wrong place, and
 * nothing said so.**
 *
 * A page calls `useCrumbTitle(call?.title)` and then RENDERS the shell. When
 * the provider lived inside that shell, the page was the provider's PARENT, so
 * the write landed on the default context and vanished. The page had published
 * a title; the bar had never been told one; both were right from where they
 * stood, and the only symptom was a crumb that stayed missing on a page whose
 * heading showed the title perfectly.
 *
 * So the arrangement under test is the REAL one — a "page" that both sets a
 * title and renders the consumer — rather than a tidy provider-wraps-both tree
 * that would pass either way.
 */
function Bar() {
  const title = useCrumbTitleValue();
  return <span data-testid="bar">{title === undefined ? "(none)" : (title ?? "(untitled)")}</span>;
}

/** Mirrors the call page: sets its title, then renders the chrome. */
function PageThatRendersTheShell({ title }: { title: string | null | undefined }) {
  useCrumbTitle(title);
  return (
    <div>
      <Bar />
      <h1>heading</h1>
    </div>
  );
}

describe("crumb title reaches the bar from a page that renders the bar", () => {
  it("delivers a title set by the page", async () => {
    render(
      <CrumbTitleProvider>
        <PageThatRendersTheShell title="مذاکرهٔ تمدید قرارداد" />
      </CrumbTitleProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("bar")).toHaveTextContent("مذاکرهٔ تمدید قرارداد"),
    );
  });

  it("keeps the three states distinct", async () => {
    const { rerender } = render(
      <CrumbTitleProvider>
        <PageThatRendersTheShell title={undefined} />
      </CrumbTitleProvider>,
    );
    // not loaded yet — the leaf is omitted, never guessed
    await waitFor(() => expect(screen.getByTestId("bar")).toHaveTextContent("(none)"));

    rerender(
      <CrumbTitleProvider>
        <PageThatRendersTheShell title={null} />
      </CrumbTitleProvider>,
    );
    // loaded, and the thing genuinely has no title — a fact, not a loading state
    await waitFor(() => expect(screen.getByTestId("bar")).toHaveTextContent("(untitled)"));
  });

  it("is LOUD when used outside a provider, rather than swallowing the write", () => {
    /*
     * The old default was `setTitle: () => {}`, which made "no provider above
     * me" indistinguishable from "nobody set a title" — the exact condition
     * that hid the bug. A missing floor is loud.
     */
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<PageThatRendersTheShell title="x" />)).toThrow(
      /outside CrumbTitleProvider/,
    );
    consoleError.mockRestore();
  });
});
