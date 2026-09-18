import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPushToTalkForTest } from "@/lib/pushToTalk";

/**
 * THE FIRST-TIME FLOW, rendered (M54).
 *
 * What these assert is the flow's CONTRACT with the server and the shell:
 * every answer leaves the browser the moment it is given, the step travels
 * with every Continue so a reload resumes, the stamp lands exactly once, and
 * a person the flow is not for (finished, or on a deployment with no flow)
 * is sent home before a single question is drawn.
 */
const replace = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/onboarding",
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const me = vi.fn();
const updateOnboarding = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    updateOnboarding: (...args: unknown[]) => updateOnboarding(...args),
  },
}));

const { Onboarding } = await import("./Onboarding");

const PERSON = {
  id: "u1", email: "sara@example.com", display_name: "سارا", display_name_en: null,
  onboarding: {}, onboarding_completed_at: null,
};

beforeEach(() => {
  replace.mockReset();
  me.mockReset().mockResolvedValue(PERSON);
  updateOnboarding.mockReset().mockResolvedValue(PERSON);
  resetPushToTalkForTest();
  window.scrollTo = vi.fn();
  localStorage.clear();
});

describe("who the flow is for", () => {
  it("draws the welcome step, with the person's name, for a member whose stamp is null", async () => {
    render(<Onboarding />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("خوش آمدی، سارا!");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a FINISHED member home without drawing a question", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding_completed_at: "2026-09-15T00:00:00Z" });
    render(<Onboarding />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("sends a member of an un-migrated deployment home — an ABSENT stamp is not an unfinished flow", async () => {
    const { onboarding_completed_at: _stamp, onboarding: _answers, ...unmigrated } = PERSON;
    me.mockResolvedValue(unmigrated);
    render(<Onboarding />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("sends nobody to sign in", async () => {
    me.mockResolvedValue(null);
    render(<Onboarding />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("resumes from the saved step", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "data", goals: ["meetings"] } });
    render(<Onboarding />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("دادهٔ تو دست خودت است");
  });
});

describe("answers leave the browser as they are given", () => {
  it("changing theme keeps the in-progress answer and does not submit another onboarding write", async () => {
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "دوست یا همکار" }));
    expect(screen.getByRole("button", { name: "ادامه" })).toBeEnabled();
    const writes = updateOnboarding.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "تغییر به پوستهٔ تیره" }));
    expect(screen.getByRole("button", { name: "ادامه" })).toBeEnabled();
    expect(updateOnboarding).toHaveBeenCalledTimes(writes);
    expect(me).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "تغییر به پوستهٔ روشن" }));
  });

  it("«Continue» waits for a choice; the choice is saved; Continue saves the next step and moves on", async () => {
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    const next = screen.getByRole("button", { name: "ادامه" });
    expect(next).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "دوست یا همکار" }));
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { source: "friend" } });
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { step: "goals" } });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("نورای چطور کمکت کند؟");
    /* the rail lights the stage of the step on screen */
    expect(screen.getByText("ثبت‌نام").closest("li")?.getAttribute("aria-current")).toBe("step");
  });

  it("a multi-choice step saves the whole list each time, in option order", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "goals" } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /کارها و پروژه‌ها/ }));
    fireEvent.click(screen.getByRole("button", { name: /^جلسه‌ها/ }));
    expect(updateOnboarding).toHaveBeenLastCalledWith({ answers: { goals: ["meetings", "tasks"] } });
  });

  it("«Back» saves the previous step and shows it", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "work", source: "friend", goals: ["meetings"] } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
    expect(updateOnboarding).toHaveBeenLastCalledWith({ answers: { step: "goals" } });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("نورای چطور کمکت کند؟");
  });
});

describe("the live controls", () => {
  it("the microphone's «yes» records that the microphone was seen working and moves on", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "mic" } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    /* jsdom has no microphone: the screen says so instead of pretending */
    expect(await screen.findByRole("alert")).toHaveTextContent(/اجازهٔ میکروفون/);
    fireEvent.click(screen.getByRole("button", { name: "بله" }));
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { micOk: true } });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("زبان‌هایی که حرف می‌زنی");
  });

  it("the key: a bindable key is bound and saved; a WRITING key is refused out loud", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "hotkey" } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    /* no key yet → the screen is already capturing */
    expect(screen.getByRole("status")).toHaveTextContent("حالا کلیدی را بزن");
    fireEvent.keyDown(window, { code: "KeyA", key: "a" });
    expect(screen.getByRole("alert")).toHaveTextContent(/برای نوشتن است/);
    expect(updateOnboarding).not.toHaveBeenCalledWith({ answers: { hotkey: "KeyA" } });

    fireEvent.keyDown(window, { code: "F9", key: "F9" });
    expect(updateOnboarding).toHaveBeenCalledWith({ answers: { hotkey: "F9" } });
    expect(screen.getByText("F9")).toBeTruthy();
    /* «yes» is live only once a key exists */
    const yes = screen.getByRole("button", { name: "بله" });
    expect(yes).toBeEnabled();
    fireEvent.click(yes);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("با نورای پیام بفرست");
  });
});

describe("the speed and the savings screens wear the questions' anatomy (2026-09-16)", () => {
  /* the split layout is the one with an END-side picture: the questions
     render an <aside>, the centred cards do not, and the retired dark stage
     did not either — so the aside is what says these two screens are drawn
     like the four before the microphone, and the h1 is the Title role every
     question opens with (the dark savings screen opened with a <p>) */
  it("the speed screen: a Title, the two speeds, the ratio on the picture side, the flow's own Continue", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "faster" } });
    const { container } = render(<Onboarding />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("آفرین!");
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveTextContent("سریع‌تر!");
    expect(container.querySelector("aside svg")).not.toBeNull();
    /* the two speeds sit on the start side, in a card */
    expect(container.querySelector("section .card")).toHaveTextContent("۱۵۰ کلمه در دقیقه");
    expect(screen.getByRole("button", { name: "ادامه" })).toHaveClass("btn-primary");
    /* nothing is drawn on the inverted stage any more */
    expect(container.querySelector(".bg-fg")).toBeNull();
  });

  it("the savings screen: a Title with the figure under it, the slider in a card, the picture side, «start working» in the same coat", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "savings" } });
    const { container } = render(<Onboarding />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("با نورای می‌توانی ذخیره کنی");
    expect(container.querySelector("aside svg")).not.toBeNull();
    expect(container.querySelector("section .card input[type=range]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "شروع کار" })).toHaveClass("btn-primary");
    expect(container.querySelector(".bg-fg")).toBeNull();
  });
});

describe("the end of the flow, and the way out", () => {
  it("«start working» stamps the end ONCE and goes home — a double press is one completion", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "savings" } });
    render(<Onboarding />);
    await screen.findByText("با نورای می‌توانی ذخیره کنی");
    const finish = screen.getByRole("button", { name: "شروع کار" });
    fireEvent.click(finish);
    fireEvent.click(finish);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(updateOnboarding.mock.calls.filter(([arg]) => (arg as { complete?: boolean }).complete === true)).toHaveLength(1);
  });

  /* «later» lives from the PERMISSIONS stage on (2026-09-18), so the two
     exit tests resume there — `data` is the first screen that has the door */
  it("«later» records the skip, stamps the end, and goes home", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "data" } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "بعداً" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(updateOnboarding).toHaveBeenCalledWith({
      answers: { skippedAt: expect.any(String) }, complete: true,
    });
  });

  it("still goes home when the stamp fails to land — the shell will send them back, which is the honest outcome", async () => {
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "data" } });
    updateOnboarding.mockRejectedValue(new Error("upstream"));
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "بعداً" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  /**
   * THE FOUR SIGN-UP QUESTIONS HAVE NO «later» (user, 2026-09-18: "remove
   * the later for the first four pages"): they are what the workspace is
   * personalised on. Asserted as the PAIR — absent on each of the four,
   * present on the first screen after them — because "no button on the
   * welcome screen" is also true of a flow that lost the exit everywhere,
   * which is the wall the door exists to prevent.
   */
  it("draws no «later» on the four sign-up questions, and draws it on the first screen after them", async () => {
    for (const step of ["welcome", "goals", "work", "places"] as const) {
      me.mockResolvedValue({ ...PERSON, onboarding: { step } });
      const view = render(<Onboarding />);
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: "بعداً" }), `«later» drawn on ${step}`).toBeNull();
      view.unmount();
    }
    me.mockResolvedValue({ ...PERSON, onboarding: { step: "data" } });
    render(<Onboarding />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "بعداً" })).toBeInTheDocument();
  });
});
