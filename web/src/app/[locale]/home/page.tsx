import type { Metadata } from "next";
import { MarketingSite } from "@/components/site/MarketingSite";

/**
 * THE COMPANY'S FRONT PAGE — a PUBLIC route inside the platform app (user
 * directive, 2026-09-05: "site becomes a public route in the platform app and
 * the login is a local link").
 *
 * ── WHY IT LIVES HERE AND NOT AT `/` ──────────────────────────────────────
 *
 * `/` is the platform: a member who opens it wants their dashboard, and
 * putting a marketing page there would make the product's own root an
 * advertisement to the people who already bought it. So the site has its own
 * address, and the middleware sends a signed-OUT visitor who asked for the
 * root here instead of to sign-in. The rule is one sentence: ask for the root
 * with no session and you get the front page; ask for a particular surface
 * and you get sign-in, because you were going somewhere.
 *
 * ── NO SHELL ──────────────────────────────────────────────────────────────
 *
 * Deliberately outside `PlatformShell`. Every element of the shell — the
 * rail, the top bar, the assistant — is a door into a product this reader has
 * no account in, and offering doors that refuse is worse than offering none.
 * The same reasoning as the guest meeting page (0158).
 */
export const metadata: Metadata = {
  title: "NeurAI",
  description: "Agents that do the work, not tools that wait for you.",
};

export default function HomePage() {
  return <MarketingSite />;
}
