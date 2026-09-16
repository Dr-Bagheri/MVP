import type { ReactNode } from "react";

/**
 * The gate's frame: the page's ground, the viewport's height, the content
 * centred. The WIDTH is each screen's own (2026-09-16): the sign-in page is a
 * two-column split — the demo beside the door — and the four narrow screens
 * (forgot, reset, pending, suspended) wear `max-w-sm` on their own card. The
 * layout used to cap everything at `max-w-sm`, which is right for one card
 * and wrong for a page that is two.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="w-full">{children}</div>
    </div>
  );
}
