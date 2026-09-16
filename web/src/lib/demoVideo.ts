/**
 * THE DEMO VIDEO'S ADDRESS — one place, read by the gate's demo panel.
 *
 * User directive, 2026-09-16: "the left side our demo video". No recording
 * exists in this repository yet (the first-run door's `ONBOARDING_VIDEOS`
 * are all null for the same reason), so the address is a BUILD-TIME setting:
 * put the file in `web/public/demo/` (or anywhere the CSP allows) and set
 * `NEXT_PUBLIC_DEMO_VIDEO_URL` in Vercel to its path. Until then the panel
 * draws the product's own illustrated scenes — never an empty player, which
 * would read as a broken page on the first screen a stranger sees.
 *
 * `null`, not `""`: an empty string is a `<video src="">`, which is a
 * request for the page itself.
 */
export const DEMO_VIDEO_SRC: string | null =
  process.env.NEXT_PUBLIC_DEMO_VIDEO_URL && process.env.NEXT_PUBLIC_DEMO_VIDEO_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_DEMO_VIDEO_URL.trim()
    : null;
