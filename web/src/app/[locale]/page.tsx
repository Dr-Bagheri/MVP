import { Suspense } from "react";
import { Home } from "@/components/platform/home/Home";
import { PlatformShell } from "@/components/platform/PlatformShell";

/**
 * THE LANDING PAGE IS THE AGENT.
 *
 * The route's history in one line: `/` redirected to `/calls` while Echo was
 * the product, became the assistant hub when Echo became an app inside a
 * platform, became the dashboard on 2026-08-25, was the assistant's door again
 * while the board was parked, was the board once more from 2026-08-29 — and is
 * the assistant again, this time with the board's own facts folded into its
 * empty state rather than living at a second address.
 *
 * NO PageContainer HERE. `Home` is a two-column row that takes the shell's full
 * height — its sidebar draws its own edge and its own scroller, and a centred
 * column around the pair would inset the menu as well as the conversation.
 *
 * **The Suspense boundary is required, not decorative.** `Hub` and
 * `HomeSidebar` read `?c=` / `?workflow=` / `?agent=` through
 * `useSearchParams()`. Next prerenders this route, and a component reading
 * search params forces a client bailout — without a boundary ABOVE it the
 * production build fails outright while the dev server renders the page
 * perfectly. The fallback is `null` rather than a skeleton home: the idle
 * screen is the first impression, and a placeholder that approximates it would
 * flash a second, wrong version of it.
 */
export default function HomePage() {
  return (
    <PlatformShell>
      <Suspense fallback={null}>
        <Home />
      </Suspense>
    </PlatformShell>
  );
}
