/**
 * THE DEMO VIDEO'S ADDRESS — one place, read by the gate's demo panel.
 *
 * Optional operator override. Without it, login plays the five bundled,
 * localized product films. No environment configuration is needed for them.
 * See docs/PRODUCT-DEMOS.md. A custom film is user-started, with native controls.
 *
 * `null`, not `""`: an empty string is a `<video src="">`, which is a
 * request for the page itself.
 */
export const DEMO_VIDEO_SRC: string | null =
  process.env.NEXT_PUBLIC_DEMO_VIDEO_URL && process.env.NEXT_PUBLIC_DEMO_VIDEO_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_DEMO_VIDEO_URL.trim()
    : null;
