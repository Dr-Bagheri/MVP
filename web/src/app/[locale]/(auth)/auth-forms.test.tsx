import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **These forms did nothing, and nothing could see it.**
 *
 * Sign-in called `router.push("/calls")`. Sign-up called
 * `router.push("/pending")`. Neither made a request. The first real user
 * "signed up", saw the waiting-for-approval screen, and the server had zero
 * rows in `auth.users` and zero in `echo.app_user`.
 *
 * Every instrument we had said fine: the pages rendered, the routes resolved,
 * the transitions worked, typecheck passed, the suite was green. The failure
 * was only visible by asking a question none of them asked — *did a request
 * leave the browser?*
 *
 * So that is what these tests assert. Not "the form submits" (true in the
 * broken version), not "the pending screen appears" (also true, and the lie
 * itself) — **that the client method was CALLED, with what the user typed, and
 * that the destination came from the server's answer rather than from the
 * submit handler.**
 */
const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/sign-in",
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const signIn = vi.fn();
const signUp = vi.fn();
const register = vi.fn();
const identityState = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      signIn: (...args: unknown[]) => signIn(...args),
      signUp: (...args: unknown[]) => signUp(...args),
      register: (...args: unknown[]) => register(...args),
      identityState: () => identityState(),
    },
  };
});

const { BffError } = await import("@/api/client");
const { default: SignInPage } = await import("./sign-in/page");
const { default: SignUpPage } = await import("./sign-up/page");

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  push.mockReset();
  signIn.mockReset();
  signUp.mockReset();
  register.mockReset();
  identityState.mockReset();
  signIn.mockResolvedValue(undefined);
  identityState.mockResolvedValue({ state: "member", me: {} });
});

describe("sign-in actually signs in", () => {
  it("sends the typed credentials to the server", async () => {
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    // THE assertion the old form would have failed: a request left the browser
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("person@example.com", "hunter2"));
  });

  it("does NOT navigate when the server refuses", async () => {
    // the old form navigated on submit unconditionally — a wrong password took
    // you into the app exactly as a right one did
    signIn.mockRejectedValue(new BffError(401, "invalid", "Invalid login credentials"));
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "wrong");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["member", "/echo"],
    ["pending", "/pending"],
    ["suspended", "/suspended"],
  ])("routes a %s to %s — the SERVER decides the destination", async (state, destination) => {
    /*
     * A correct password is not permission. `pending` and `suspended` both
     * sign in perfectly and must land somewhere else, and they must land in
     * DIFFERENT somewhere-elses: one points at an admin who can help, the
     * other at a vendor, and sending a suspended org to wait for an admin is
     * an instruction that cannot work.
     */
    identityState.mockResolvedValue({ state, me: {} });
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
  });

  it("offers the org step when the token has no membership (M15 recovery)", async () => {
    // `unregistered` is authenticated-but-unknown-to-the-product. Treated as
    // signed-out, this person retries their correct password forever.
    identityState.mockResolvedValue({ state: "unregistered" });
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    const orgField = await screen.findByLabelText(/^نام سازمان/);
    expect(push).not.toHaveBeenCalled();

    register.mockResolvedValue({ id: "u-1" });
    fireEvent.change(orgField, { target: { value: "شرکت نمونه" } });
    fireEvent.click(screen.getByRole("button", { name: "تکمیل ثبت‌نام" }));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({ display_name: "person", org_name: "شرکت نمونه" }),
    );
  });
});

describe("sign-up actually creates an account", () => {
  const fill = () => {
    type(/^رایانامه/, "person@example.com");
    type(/^نام نمایشی/, "شخص");
    type(/^نام سازمان/, "شرکت نمونه");
    type(/^گذرواژه/, "hunter2");
  };

  it("sends the form to the server", async () => {
    signUp.mockResolvedValue({ confirmationRequired: false, member: { id: "u-1" } });
    render(<SignUpPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ثبت‌نام" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "person@example.com",
        password: "hunter2",
        display_name: "شخص",
        org_name: "شرکت نمونه",
      }),
    );
  });

  it("shows the pending screen ONLY after the server created the account", async () => {
    signUp.mockRejectedValue(new BffError(400, "invalid", "password is too short"));
    render(<SignUpPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ثبت‌نام" }));

    /*
     * The heart of it. The old form routed here on submit, so a person whose
     * sign-up FAILED still saw "an admin will accept you shortly" — a screen
     * whose entire job is to reassure, shown for an account that does not
     * exist.
     */
    expect(await screen.findByRole("alert")).toHaveTextContent("password is too short");
    expect(push).not.toHaveBeenCalled();
  });

  it("distinguishes confirm-your-email from you-are-in-the-queue", async () => {
    // 202: identity created, product row NOT created. Showing the pending
    // screen would claim a queue entry that does not exist, and the person
    // would wait for an admin who can never see them.
    signUp.mockResolvedValue({ confirmationRequired: true, member: null });
    render(<SignUpPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "ثبت‌نام" }));

    expect(await screen.findByText(/رایانامه‌تان را تأیید کنید/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
