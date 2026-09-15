import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 *
 * THE GATE IS ONE EMAIL FIELD NOW (M54, 2026-09-15): «Continue» asks for a
 * code, the code screen verifies it, and the password form is one link away
 * for whoever has one. The assertions above hold for all three; the sign-up
 * page is a redirect and is asserted as one.
 */
const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/sign-in",
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const signIn = vi.fn();
const requestEmailCode = vi.fn();
const verifyEmailCode = vi.fn();
const register = vi.fn();
const identityState = vi.fn();
const setPassword = vi.fn();
const oauthPasswordEnrollment = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      signIn: (...args: unknown[]) => signIn(...args),
      requestEmailCode: (...args: unknown[]) => requestEmailCode(...args),
      verifyEmailCode: (...args: unknown[]) => verifyEmailCode(...args),
      register: (...args: unknown[]) => register(...args),
      identityState: () => identityState(),
      setPassword: (...args: unknown[]) => setPassword(...args),
      oauthPasswordEnrollment: () => oauthPasswordEnrollment(),
    },
  };
});

const { BffError } = await import("@/api/client");
const { default: SignInPage, landingFor } = await import("./sign-in/page");

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** the gate's first press */
const askForCode = (email = "person@example.com") => {
  type(/^رایانامه/, email);
  fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
};

/** the secondary path: open the password form and fill it */
const openPasswordForm = () => {
  fireEvent.click(screen.getByRole("button", { name: "ورود با گذرواژه" }));
};

beforeEach(() => {
  push.mockReset();
  signIn.mockReset();
  requestEmailCode.mockReset();
  verifyEmailCode.mockReset();
  register.mockReset();
  identityState.mockReset();
  setPassword.mockReset();
  oauthPasswordEnrollment.mockReset();
  signIn.mockResolvedValue(undefined);
  requestEmailCode.mockResolvedValue(undefined);
  verifyEmailCode.mockResolvedValue(undefined);
  identityState.mockResolvedValue({ state: "member", me: { onboarding_completed_at: "2026-09-15T00:00:00Z" } });
  setPassword.mockResolvedValue(undefined);
  oauthPasswordEnrollment.mockResolvedValue({ required: false });
  // 0078: OAuthButtons asks /api/auth-methods before drawing anything —
  // answer it with both enabled so the absence assertions see the buttons
  // if anything ever draws them again
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify([
      { provider: "google", enabled: true },
      { provider: "github", enabled: true },
    ]), { headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the email-code gate (M54)", () => {
  it("«Continue» asks the server for a code, with the typed address", async () => {
    render(<SignInPage />);
    askForCode("person@example.com");
    // THE assertion the old forms would have failed: a request left the browser
    await waitFor(() => expect(requestEmailCode).toHaveBeenCalledWith("person@example.com"));
    // and the screen moved to the code — naming the address the mail went to
    expect(await screen.findByLabelText(/^کد شش‌رقمی/)).toBeTruthy();
    expect(screen.getByText(/person@example\.com/)).toBeTruthy();
  });

  it("the typed code is verified against that address, and the SERVER decides the destination", async () => {
    render(<SignInPage />);
    askForCode();
    const box = await screen.findByLabelText(/^کد شش‌رقمی/);
    fireEvent.change(box, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(verifyEmailCode).toHaveBeenCalledWith("person@example.com", "123456"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("Persian digits typed into the code box reach the server as ASCII", async () => {
    render(<SignInPage />);
    askForCode();
    const box = await screen.findByLabelText(/^کد شش‌رقمی/);
    fireEvent.change(box, { target: { value: "۱۲۳۴۵۶" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(verifyEmailCode).toHaveBeenCalledWith("person@example.com", "123456"));
  });

  it("a wrong code says so and navigates nowhere", async () => {
    verifyEmailCode.mockRejectedValue(new BffError(401, "invalid", "Token has expired or is invalid"));
    render(<SignInPage />);
    askForCode();
    const box = await screen.findByLabelText(/^کد شش‌رقمی/);
    fireEvent.change(box, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/کد درست نیست/);
    expect(push).not.toHaveBeenCalled();
  });

  it("a rate-limited request is named as one, not as a failure", async () => {
    requestEmailCode.mockRejectedValue(new BffError(429, "rate_limited", "over_email_send_rate_limit"));
    render(<SignInPage />);
    askForCode();
    expect(await screen.findByRole("alert")).toHaveTextContent(/چند لحظه صبر کن/);
    expect(screen.queryByLabelText(/^کد شش‌رقمی/)).toBeNull();
  });

  it("a brand-new person is registered with NO questions and lands on the first-time flow", async () => {
    /* the code verified; the product has never heard of them (unregistered);
       the bare register founds their workspace (db/0223) and the next identity
       read says member with an unfinished flow */
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "member", me: { onboarding_completed_at: null } });
    register.mockResolvedValue({ id: "u-1", status: "active", role: "owner" });
    render(<SignInPage />);
    askForCode("newcomer@example.com");
    const box = await screen.findByLabelText(/^کد شش‌رقمی/);
    fireEvent.change(box, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
    // one call, no org named, and no form in between
    expect(register).toHaveBeenCalledWith({ display_name: "newcomer" });
    expect(screen.queryByLabelText(/^نام سازمان/)).toBeNull();
  });

  it("a member who has finished the flow lands home; one who has not lands on the flow", () => {
    expect(landingFor({ onboarding_completed_at: "2026-09-15T00:00:00Z" })).toBe("/");
    expect(landingFor({ onboarding_completed_at: null })).toBe("/onboarding");
    /* ABSENT is a deployment without the flow — home, never a route that
       cannot save */
    expect(landingFor(undefined)).toBe("/");
    expect(landingFor({} as { onboarding_completed_at?: string | null })).toBe("/");
  });

  it("«use a different email» goes back to the address, and the code is asked for again from there", async () => {
    render(<SignInPage />);
    askForCode("first@example.com");
    await screen.findByLabelText(/^کد شش‌رقمی/);
    fireEvent.click(screen.getByRole("button", { name: "رایانامهٔ دیگر" }));
    expect(await screen.findByLabelText(/^رایانامه/)).toBeTruthy();
    askForCode("second@example.com");
    await waitFor(() => expect(requestEmailCode).toHaveBeenLastCalledWith("second@example.com"));
  });
});

describe("the password path is one link away and still signs in", () => {
  it("sends the typed credentials to the server", async () => {
    render(<SignInPage />);
    openPasswordForm();
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("person@example.com", "hunter2"));
  });

  it("does NOT navigate when the server refuses", async () => {
    // the old form navigated on submit unconditionally — a wrong password took
    // you into the app exactly as a right one did
    signIn.mockRejectedValue(new BffError(401, "invalid", "Invalid login credentials"));
    render(<SignInPage />);
    openPasswordForm();
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "wrong");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["member", "/"],
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
    identityState.mockResolvedValue({ state, me: { onboarding_completed_at: "2026-09-15T00:00:00Z" } });
    render(<SignInPage />);
    openPasswordForm();
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
  });

  it("says what the SERVER said when registration is refused", async () => {
    /* `org_not_found` is a fact about a name and `no_organization` about the
       platform — neither is something this person can fix by typing, and a
       generic "try again" would hide which one it is. */
    identityState.mockResolvedValue({ state: "unregistered" });
    register.mockRejectedValue(
      new BffError(400, "invalid", "this platform has no organization to join yet"));
    render(<SignInPage />);
    openPasswordForm();
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("this platform has no organization to join yet");
    expect(push).not.toHaveBeenCalled();
  });

  it("an INVITED arrival never sees an org form — the bare register redeems and routes in (db/0060)", async () => {
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "member", me: { onboarding_completed_at: "2026-09-15T00:00:00Z" } });
    register.mockResolvedValue({ id: "u-2", status: "active" });
    render(<SignInPage />);
    openPasswordForm();
    type(/^رایانامه/, "invited@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(register).toHaveBeenCalledWith({ display_name: "invited" });
  });
});

describe("the confirm-email landing (?confirmed=…)", () => {
  it("?confirmed=1 SAYS the account is ready and routes with no code re-entry", async () => {
    // /api/auth/confirm already wrote the session cookie (the one-click link);
    // arriving here with the marker must (a) say the confirmation worked and
    // (b) ask the server who we are and route: a fresh person is registered
    // and lands on the first-time flow. Deleting the arrival effect leaves
    // this red.
    window.history.replaceState(null, "", "/?confirmed=1");
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "member", me: { onboarding_completed_at: null } });
    register.mockResolvedValue({ id: "u-1", status: "active" });
    render(<SignInPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(/حسابتان آماده است/);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
  });

  it("?confirmed=1 with a registered identity goes straight in", async () => {
    window.history.replaceState(null, "", "/?confirmed=1");
    render(<SignInPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("?confirmed=failed says the link is dead instead of presenting a bare form", async () => {
    window.history.replaceState(null, "", "/?confirmed=failed");
    render(<SignInPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/پیوند تأیید نامعتبر/);
    expect(identityState).not.toHaveBeenCalled();
  });

  it("?confirmed=fragment tells the person to type the code — a link that carried its session in the fragment is refused (M1)", async () => {
    window.history.replaceState(null, "", "/?confirmed=fragment");
    render(<SignInPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/کد شش‌رقمی داخل نامه/);
    expect(identityState).not.toHaveBeenCalled();
  });

  it("?oauth=failed names the provider failure — not the email-link message", async () => {
    window.history.replaceState(null, "", "/?oauth=failed");
    render(<SignInPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/حساب بیرونی/);
  });
});

describe("the OAuth arrival (?oauth=ok)", () => {
  it("requires a first password before routing even an already registered member", async () => {
    window.history.replaceState(null, "", "/?oauth=ok");
    oauthPasswordEnrollment.mockResolvedValue({ required: true });
    render(<SignInPage />);

    expect(await screen.findByLabelText(/^انتخاب گذرواژه/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(identityState).not.toHaveBeenCalled();

    type(/^انتخاب گذرواژه/, "password-one");
    type(/^تکرار گذرواژه/, "password-one");
    fireEvent.click(screen.getByRole("button", { name: "ثبت گذرواژه" }));

    await waitFor(() => expect(setPassword).toHaveBeenCalledWith("password-one"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("does not interrupt a later OAuth arrival once its password exists", async () => {
    window.history.replaceState(null, "", "/?oauth=ok");
    oauthPasswordEnrollment.mockResolvedValue({ required: false });
    render(<SignInPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByLabelText(/^انتخاب گذرواژه/)).toBeNull();
    expect(setPassword).not.toHaveBeenCalled();
  });
});

/**
 * NEITHER GATE OFFERS A PROVIDER (user directive, 2026-09-15: "remove these
 * two button git hub and google for now").
 *
 * THE READ IS THE LOAD-BEARING HALF: the `beforeEach` stub answers
 * `/api/auth-methods` with BOTH providers enabled, so a missing link could
 * always be a link still waiting for its fetch. It cannot be here, because
 * the fetch never happens — nothing on the gate asks which providers are
 * enabled any more. That is a fact about the COMPONENT being unmounted rather
 * than about what it chose to draw, and it is what a re-added
 * `<OAuthButtons />` fails first.
 */
describe("the provider buttons are off the gate (2026-09-15)", () => {
  it("offers neither Google nor GitHub on any of the three screens, and asks nothing about them", async () => {
    render(<SignInPage />);
    await screen.findByLabelText(/^رایانامه/);
    expect(fetch, "something still asks which providers are enabled").not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Google/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /GitHub/ })).toBeNull();
    expect(screen.queryByText(/یا ادامه با/)).toBeNull();

    openPasswordForm();
    await screen.findByLabelText(/^گذرواژه/);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Google/ })).toBeNull();
  });
});

/**
 * SIGNING UP IS SIGNING IN. The old two-step form (Supabase identity, then
 * core's /v1/signup) is gone; the address redirects to the gate. Asserted on
 * the module rather than by rendering: a server redirect throws, and what
 * matters is that it throws TOWARD /sign-in.
 */
describe("/sign-up is a redirect to the gate", () => {
  it("redirects to /sign-in in the visitor's locale", async () => {
    const redirect = vi.fn(() => { throw new Error("NEXT_REDIRECT"); });
    vi.doMock("@/i18n/routing", () => ({ redirect }));
    vi.resetModules();
    const { default: SignUpRedirect } = await import("./sign-up/page");
    await expect(SignUpRedirect({ params: Promise.resolve({ locale: "fa" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith({ href: "/sign-in", locale: "fa" });
    vi.doUnmock("@/i18n/routing");
  });
});
