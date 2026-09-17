import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMySignature = vi.fn();
const clearMySignature = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    mySignatureUrl: (v = 0) => (v > 0 ? `/api/me/signature?v=${v}` : "/api/me/signature"),
    uploadMySignature: (b64: string) => uploadMySignature(b64),
    clearMySignature: () => clearMySignature(),
  },
}));

const { SignatureEditor } = await import("./SignatureEditor");

/** the bytes route answers 200 (on file) or 404 (none) — that answer IS the
    state, so the fixture is a fetch, not a prop */
function onFile(present: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    present ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : null,
    { status: present ? 200 : 404, headers: { "content-type": "image/png" } },
  )));
}

beforeEach(() => {
  uploadMySignature.mockReset();
  clearMySignature.mockReset();
  uploadMySignature.mockResolvedValue({ uploaded: true, mime: "image/png" });
  clearMySignature.mockResolvedValue(undefined);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 300, height: 90, close: () => {} }));
  const proto = globalThis.HTMLCanvasElement.prototype as unknown as { getContext: unknown; toDataURL: unknown };
  proto.getContext = () => ({ drawImage: () => {} });
  proto.toDataURL = () => "data:image/png;base64,U0lH";
});

/**
 * THE SIGNATURE ON FILE (db/0229), edited the way the photo is: one picture
 * control, the camera badge to change, a trash while there is one — and,
 * unlike the photo, a dialog before the trash acts, because the file is gone
 * afterwards and the meetings already signed are NOT.
 */
describe("SignatureEditor", () => {
  it("shows the signature on file with a trash beside it, and asks before removing", async () => {
    onFile(true);
    render(<SignatureEditor />);
    /* the picture, on white — the bytes route with its cache-buster */
    await waitFor(() => expect(screen.getByRole("img", { name: "امضا" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "تغییر امضا" })).toBeInTheDocument();
    const trash = screen.getByRole("button", { name: "حذف امضا" });
    expect(trash.querySelector("svg")).not.toBeNull();

    await userEvent.click(trash);
    /* the platform's one dialog, saying what removal COSTS and does not
       cost — nothing has been sent yet */
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("صورت‌جلسه‌هایی که پیش‌تر امضا کرده‌اید");
    expect(clearMySignature).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "انصراف" }));
    expect(clearMySignature).not.toHaveBeenCalled();
  });

  it("removes on the dialog's yes and shows the empty word afterwards", async () => {
    onFile(true);
    render(<SignatureEditor />);
    await userEvent.click(await screen.findByRole("button", { name: "حذف امضا" }));
    const dialog = await screen.findByRole("alertdialog");
    const yes = dialog.querySelectorAll("button");
    const confirm = [...yes].find((b) => b.textContent === "حذف امضا" && b.closest("[role=alertdialog]"));
    expect(confirm).toBeTruthy();
    await userEvent.click(confirm!);
    await waitFor(() => expect(clearMySignature).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("ثبت نشده")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "حذف امضا" })).toBeNull();
  });

  it("offers upload and no trash while there is none, and files the derived picture on pick", async () => {
    onFile(false);
    render(<SignatureEditor />);
    await waitFor(() => expect(screen.getByText("ثبت نشده")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "بارگذاری امضا" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف امضا" })).toBeNull();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array([1, 2, 3])], "sig.png", { type: "image/png" }));
    /* the BASE64 of the derived picture, never the file's own bytes: what
       goes up is what the person will see on the minutes */
    await waitFor(() => expect(uploadMySignature).toHaveBeenCalledWith("U0lH"));
    /* and the control now shows a picture, with the trash back */
    await waitFor(() => expect(screen.getByRole("button", { name: "حذف امضا" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "امضا" })).toBeInTheDocument();
  });
});
