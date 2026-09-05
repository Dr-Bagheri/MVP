import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersianDigitsTyping } from "./PersianDigitsTyping";

/**
 * Typed digits follow the language (2026-09-05). The assertions read the
 * CONTROLLED value after the event: React re-renders the field from state,
 * so a Persian value here proves both halves — the DOM was rewritten before
 * React looked, and React stored what it read. A version that converted the
 * DOM but lost the event would snap back to ASCII on the re-render and fail.
 *
 * Every positive case has a control beside it that must NOT convert: the
 * pinned-LTR text field, the email, the number, and the English locale.
 */
function Form({ locale }: { locale: string }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [count, setCount] = useState("");
  return (
    <div dir="rtl">
      <PersianDigitsTyping locale={locale} />
      <input aria-label="توضیح" value={text} onChange={(e) => setText(e.target.value)} />
      <textarea aria-label="متن" value={note} onChange={(e) => setNote(e.target.value)} />
      <input aria-label="نام کاربری" dir="ltr" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <input aria-label="ایمیل" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input aria-label="شمار" type="number" value={count} onChange={(e) => setCount(e.target.value)} />
    </div>
  );
}

const type = (label: string, value: string): HTMLInputElement => {
  const el = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.input(el, { target: { value } });
  return el;
};

describe("PersianDigitsTyping", () => {
  beforeEach(() => { document.documentElement.setAttribute("dir", "rtl"); });
  afterEach(() => { document.documentElement.removeAttribute("dir"); });

  it("digits typed into a Persian text field become Persian, and the state holds them", () => {
    render(<Form locale="fa" />);
    expect(type("توضیح", "دیتابیس صوتی برای تمرین مدل 1000 ساعتی").value)
      .toBe("دیتابیس صوتی برای تمرین مدل ۱۰۰۰ ساعتی");
    expect(type("متن", "ردیف 12 و 7").value).toBe("ردیف ۱۲ و ۷");
  });

  it("Arabic-Indic digits become Persian too — one shape per text", () => {
    render(<Form locale="fa" />);
    expect(type("توضیح", "سال ١٤٠٥").value).toBe("سال ۱۴۰۵");
  });

  it("the controls: a field pinned ltr, an email and a number keep ASCII", () => {
    render(<Form locale="fa" />);
    expect(type("نام کاربری", "sara1992").value).toBe("sara1992");
    expect(type("ایمیل", "a1@b.io").value).toBe("a1@b.io");
    expect(type("شمار", "42").value).toBe("42");
  });

  it("the English locale converts nothing, even inside an rtl box", () => {
    render(<Form locale="en" />);
    expect(type("توضیح", "room 1000").value).toBe("room 1000");
  });

  it("the caret stays where the person left it", () => {
    render(<Form locale="fa" />);
    const el = screen.getByLabelText("توضیح") as HTMLInputElement;
    /* set the value the way a keystroke does, with the caret mid-text */
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, "12 نفر");
    el.setSelectionRange(2, 2);
    fireEvent.input(el);
    expect(el.value).toBe("۱۲ نفر");
    expect(el.selectionStart).toBe(2);
  });
});
