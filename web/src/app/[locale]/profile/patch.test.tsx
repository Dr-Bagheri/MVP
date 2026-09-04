import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/api/types";

/**
 * The profile form's ONE hard requirement: an empty box means two different
 * things, and the form has to say which.
 *
 * Empty where a value was saved is «clear it» — `null` on the wire. Empty where
 * nothing was ever saved is «nothing happened» — the key omitted. core/ carries
 * that distinction all the way to SQL precisely so that removing a Latin name
 * is expressible, and every layer above it can quietly collapse the two: the
 * reflex `coalesce`, a `Partial<User>` type, a patch built by spreading state.
 * Each of those produces a save that reports success and changes nothing, and
 * none of them produces an error anywhere.
 *
 * So these assert the PATCH BODY, not the screen. "The form submitted" is true
 * in every broken version of this.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/profile",
  useRouter: () => ({ replace: vi.fn() }),
  /* the section toolbar's items are locale-aware Links, and a mock that omits
     an export the component renders makes React render `undefined` — which
     arrived as nine failing tests about a patch body, none of them about
     routing */
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

const me = vi.fn();
const updateProfile = vi.fn();

/**
 * `importOriginal` rather than a hand-written stub, so `BffError` is THE class
 * the screen tests `instanceof` against. A local look-alike would satisfy every
 * assertion here and fail in the browser — a fake that cannot disagree with the
 * thing it stands in for.
 */
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      me: () => me(),
      models: async () => ({ models: [], preferred_model: null, tool_capability_filtered: false }),
      updateProfile: (patch: unknown) => updateProfile(patch),
      setPreferredModel: vi.fn(),
      setLocale: vi.fn(),
      /* the header's two counts. They are a DIFFERENT subject from this
         file's — what matters here is that a failing or slow read of them
         cannot break the form, which is why they answer empty rather than
         being left undefined for the component to trip over. */
      meetings: async () => [],
      taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    },
  };
});

const { BffError } = await import("@/api/client");
const { default: ProfilePage } = await import("./[[...section]]/page");

const SAVED: User = {
  id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
  display_name_en: "Sara", email: "sara@example.test", avatar_url: null,
  role: "member", status: "active", locale: "fa", model_id: null,
  created_at: new Date().toISOString(),
};

const NO_HANDLE: User = { ...SAVED, username: null, display_name_en: null };

/**
 * Matched loosely on purpose. `Field` renders its `hint` INSIDE the `<label>`,
 * so a hinted field's accessible NAME is «نام کاربری۳ تا ۳۲ نویسه…» — the
 * description folded into the name. An exact query fails here and that failure
 * is the finding, not a test detail: a screen reader announces the whole hint
 * as the field's name on every focus. Reported to ui.tsx's owner rather than
 * worked around by restructuring a component every form in the app uses.
 */
const field = (label: string) =>
  screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "ذخیره" });

async function open(user: User) {
  me.mockResolvedValue(user);
  /* the identity section, which is what a bare /profile means — this
     file is about the identity form and its patch shape */
  /* AWAITED act, because the page reads its section from `use(params)` and a
     promise SUSPENDS: a bare render() mounts the fallback and the tree the
     assertions want never arrives inside the query timeout. */
  await act(async () => {
    render(<ProfilePage params={Promise.resolve({})} />);
  });
  await screen.findByDisplayValue(user.display_name);
}

describe("clearing a field is distinguishable from leaving it alone", () => {
  beforeEach(() => {
    me.mockReset();
    updateProfile.mockReset();
    updateProfile.mockImplementation(async (patch: Record<string, unknown>) => ({
      ...SAVED,
      ...patch,
    }));
  });

  it("sends null for a Latin name that was emptied — and omits what was not touched", async () => {
    await open(SAVED);
    fireEvent.change(field("نام به انگلیسی"), { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    const patch = updateProfile.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.display_name_en).toBeNull();
    // the assertion that catches a spread-the-whole-state patch: an untouched
    // key must be ABSENT, not present-and-equal
    expect("username" in patch).toBe(false);
    expect("display_name" in patch).toBe(false);
  });

  it("omits a box that was empty to begin with rather than sending null", async () => {
    await open(NO_HANDLE);
    fireEvent.change(field("نام به فارسی"), { target: { value: "سارا ک" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    const patch = updateProfile.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch).toEqual({ display_name: "سارا ک" });
    /*
     * Sending `username: null` here would be a write that changes nothing —
     * harmless to the row, and an "edited their username" entry in anything
     * that watches this route. Opening a page is not an edit.
     */
  });

  it("cannot save an untouched form at all", async () => {
    await open(SAVED);
    expect(saveButton()).toBeDisabled();
    // core/ answers an empty patch with a 400 rather than a no-op UPDATE, so
    // an always-enabled button shows an error for having changed your mind
    fireEvent.click(saveButton());
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("treats a case-only handle edit as no edit, because core/ lower-cases", async () => {
    await open(SAVED);
    fireEvent.change(field("نام کاربری"), { target: { value: "SARA" } });
    expect(saveButton()).toBeDisabled();
  });

  it("adopts the server's row, so a lower-cased handle is shown as it was stored", async () => {
    await open(NO_HANDLE);
    updateProfile.mockResolvedValue({ ...NO_HANDLE, username: "sara_k" });
    fireEvent.change(field("نام کاربری"), { target: { value: "  Sara_K  " } });
    fireEvent.click(saveButton());

    // NOT what was typed: the box must show what the database now holds, or
    // the screen quietly disagrees with the row it just wrote
    expect(await screen.findByDisplayValue("sara_k")).toBeTruthy();
  });
});

describe("a refusal lands where the person can act on it", () => {
  beforeEach(() => {
    me.mockReset();
    updateProfile.mockReset();
  });

  it("puts a 409 on the username field, in the server's words", async () => {
    /*
     * "already taken" and "belonged to a deleted account and is permanently
     * retired" are different facts with different next steps, and only core/
     * can tell them apart — it looks for a tombstone holding the handle. A
     * client sentence would flatten both into "not available" and tell someone
     * to keep trying a handle that can never be free.
     */
    const retired = "that username belonged to a deleted account and is permanently retired";
    updateProfile.mockRejectedValue(new BffError(409, "conflict", retired));
    await open(SAVED);
    fireEvent.change(field("نام کاربری"), { target: { value: "ghost" } });
    fireEvent.click(saveButton());

    const message = await screen.findByText(retired);
    expect(field("نام کاربری").getAttribute("aria-describedby")).toBe(message.id);
    expect(field("نام کاربری")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a 400 verbatim instead of re-deriving the rule", async () => {
    // core/ owns `^[a-z][a-z0-9_]{2,31}$` and states it in the refusal. A copy
    // of that regex here is a rule this screen does not own, and it would go
    // stale the day the constraint moves — silently, with no test to notice.
    const rule = "username must be 3–32 characters, start with a lowercase letter, "
      + "and contain only lowercase letters, digits and underscores";
    updateProfile.mockRejectedValue(new BffError(400, "invalid", rule));
    await open(SAVED);
    fireEvent.change(field("نام کاربری"), { target: { value: "9lives" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(rule);
  });

  it("does not blame the field for a failure that was not about the field", async () => {
    // 502 is core/ not answering. Pinning it to the username would tell someone
    // to change a perfectly good handle to fix an outage.
    updateProfile.mockRejectedValue(new BffError(502, "upstream"));
    await open(SAVED);
    fireEvent.change(field("نام کاربری"), { target: { value: "sara2" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("ذخیره نشد");
    expect(field("نام کاربری")).not.toHaveAttribute("aria-invalid");
  });

  it("stays on the typed value after a refusal", async () => {
    // Resetting the box to the saved value on failure destroys what they typed
    // and is indistinguishable from "the save worked and then reverted".
    updateProfile.mockRejectedValue(new BffError(409, "conflict", "username is already taken"));
    await open(SAVED);
    fireEvent.change(field("نام کاربری"), { target: { value: "taken_one" } });
    fireEvent.click(saveButton());

    await screen.findByText("username is already taken");
    expect(field("نام کاربری").value).toBe("taken_one");
  });
});
