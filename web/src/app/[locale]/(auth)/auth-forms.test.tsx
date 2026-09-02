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
const setPassword = vi.fn();
const oauthPasswordEnrollment = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      signIn: (...args: unknown[]) => signIn(...args),
      signUp: (...args: unknown[]) => signUp(...args),
      register: (...args: unknown[]) => register(...args),
      identityState: () => identityState(),
      setPassword: (...args: unknown[]) => setPassword(...args),
      oauthPasswordEnrollment: () => oauthPasswordEnrollment(),
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
  setPassword.mockReset();
  oauthPasswordEnrollment.mockReset();
  signIn.mockResolvedValue(undefined);
  identityState.mockResolvedValue({ state: "member", me: {} });
  setPassword.mockResolvedValue(undefined);
  oauthPasswordEnrollment.mockResolvedValue({ required: false });
  // 0078: OAuthButtons asks /api/auth-methods before drawing anything —
  // answer it with both enabled so the button assertions see the buttons
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify([
      { provider: "google", enabled: true },
      { provider: "github", enabled: true },
    ]), { headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    identityState.mockResolvedValue({ state, me: {} });
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
  });

  /* NOTHING IS ASKED (user directive, 2026-09-02). `unregistered` is
     authenticated-but-unknown-to-the-product — treated as signed-out, this
     person retries their correct password forever. The old branch handed
     them a form asking for the name of an organization nobody had told
     them; db/0149 resolves it server-side and lands them pending. */
  it("registers an unknown token with NO questions and routes to the waiting room", async () => {
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "pending" });
    register.mockResolvedValue({ id: "u-1", status: "pending" });
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/pending"));
    // the whole point: one call, no org named, and no form in between
    expect(register).toHaveBeenCalledWith({ display_name: "person" });
    expect(screen.queryByLabelText(/^نام سازمان/)).toBeNull();
  });

  it("says what the SERVER said when registration is refused", async () => {
    /* `signups_closed` is a fact about the platform and `org_not_found`
       about a name — neither is something this person can fix by typing,
       and a generic "try again" would hide which one it is. */
    identityState.mockResolvedValue({ state: "unregistered" });
    register.mockRejectedValue(
      new BffError(400, "invalid", "this platform is not accepting new members yet"));
    render(<SignInPage />);
    type(/^رایانامه/, "person@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("this platform is not accepting new members yet");
    expect(push).not.toHaveBeenCalled();
  });

  it("an INVITED arrival never sees the org form — the bare register redeems and routes in (db/0060)", async () => {
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "member" });
    // the probe succeeds: the platform emailed this person, the door opened
    register.mockResolvedValue({ id: "u-2", status: "active" });
    render(<SignInPage />);
    type(/^رایانامه/, "invited@example.com");
    type(/^گذرواژه/, "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(register).toHaveBeenCalledWith({ display_name: "invited" });
  });
});

describe("the confirm-email landing (?confirmed=…)", () => {
  afterEach(() => {
    // the URL is ambient state; a leaked query would make later tests
    // "arrive from a confirmation link" without meaning to
    window.history.replaceState(null, "", "/");
  });

  it("?confirmed=1 SAYS the account is ready and routes with no password re-entry", async () => {
    // /api/auth/confirm already wrote the session cookie; arriving here with
    // the marker must (a) say the confirmation worked — a silent redirect
    // reads as nothing happening — and (b) ask the server who we are and
    // route: a fresh person is registered and lands in the waiting room, with
    // no second password prompt two minutes after the first. Deleting the
    // arrival effect leaves this red.
    window.history.replaceState(null, "", "/?confirmed=1");
    identityState
      .mockResolvedValueOnce({ state: "unregistered" })
      .mockResolvedValue({ state: "pending" });
    register.mockResolvedValue({ id: "u-1", status: "pending" });
    render(<SignInPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(/حسابتان آماده است/);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pending"));
  });

  it("?confirmed=1 with a registered identity goes straight in", async () => {
    window.history.replaceState(null, "", "/?confirmed=1");
    identityState.mockResolvedValue({ state: "member" });
    render(<SignInPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("?confirmed=failed says the link is dead instead of presenting a bare form", async () => {
    window.history.replaceState(null, "", "/?confirmed=failed");
    render(<SignInPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/پیوند تأیید نامعتبر/);
    expect(identityState).not.toHaveBeenCalled();
  });

  it("?oauth=failed names the provider failure — not the email-link message", async () => {
    window.history.replaceState(null, "", "/?oauth=failed");
    render(<SignInPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/حساب بیرونی/);
  });
});

describe("the OAuth arrival (?oauth=ok)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("requires a first password before routing even an already registered member", async () => {
    window.history.replaceState(null, "", "/?oauth=ok");
    oauthPasswordEnrollment.mockResolvedValue({ required: true });
    identityState.mockResolvedValue({ state: "member", me: {} });
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
    identityState.mockResolvedValue({ state: "member", me: {} });
    render(<SignInPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByLabelText(/^انتخاب گذرواژه/)).toBeNull();
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe("the provider buttons are REAL links (the mock's dead Google button is this screen's origin story)", () => {
  it.each([
    ["Google", "/api/auth/oauth/google"],
    ["GitHub", "/api/auth/oauth/github"],
  ])("sign-in offers %s pointing at the live PKCE route", async (name, href) => {
    render(<SignInPage />);
    // findBy: the buttons draw only after /api/auth-methods answers (0078)
    const a = await screen.findByRole("link", { name: new RegExp(name) });
    // the EXACT BFF path, un-locale-prefixed: a /fa/api/... href would 404,
    // which is precisely a dead button wearing a live one's clothes
    expect(a.getAttribute("href")).toBe(href);
  });

  it("sign-up offers both providers too", async () => {
    render(<SignUpPage />);
    expect((await screen.findByRole("link", { name: /Google/ })).getAttribute("href")).toBe("/api/auth/oauth/google");
    expect((await screen.findByRole("link", { name: /GitHub/ })).getAttribute("href")).toBe("/api/auth/oauth/github");
  });

  it("a method an admin turned OFF is not offered (0078) — the negative is the feature", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify([
        { provider: "google", enabled: false },
        { provider: "github", enabled: true },
      ]), { headers: { "content-type": "application/json" } }))));
    render(<SignInPage />);
    await screen.findByRole("link", { name: /GitHub/ });
    expect(screen.queryByRole("link", { name: /Google/ })).toBeNull();
  });
});

describe("sign-up actually creates an account", () => {
  const fill = () => {
    type(/^رایانامه/, "person@example.com");
    type(/^نام نمایشی/, "شخص");
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
