"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  SceneConversation, SceneDesk, SceneFrames, SceneLock, ScenePeople,
} from "@/components/onboarding/Illustrations";
import { DEMO_VIDEO_SRC } from "@/lib/demoVideo";

/**
 * THE OTHER HALF OF THE GATE — the demo beside the door (user directive,
 * 2026-09-16: "the login page should look like a mixture of these two images:
 * a login on the right side always, and the left side our demo video").
 *
 * The reference's left half is a headline over a moving picture of the
 * product. Ours is the same shape with two sources: the DEMO VIDEO when one
 * exists (`DEMO_VIDEO_SRC` — a build-time address, see lib/demoVideo.ts),
 * and until then the product's own illustrated scenes, one sentence each,
 * turning every five seconds with the reference's dots underneath. Never an
 * empty player: a broken frame on the first screen a stranger sees is the
 * thing this repo refuses to ship, and the scenes are the ones the
 * first-time flow already draws — one set of pictures for one product.
 *
 * Motion is a preference: `prefers-reduced-motion` stops the turning and
 * leaves the dots as the way through.
 */
const SCENES = [
  { key: "meetings", Scene: SceneConversation },
  { key: "assistant", Scene: SceneFrames },
  { key: "tasks", Scene: SceneDesk },
  { key: "team", Scene: ScenePeople },
  { key: "privacy", Scene: SceneLock },
] as const;

/** how long each scene stays — long enough to read the sentence twice */
const SCENE_MS = 5000;

export function DemoPanel() {
  const t = useTranslations("auth");
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (DEMO_VIDEO_SRC !== null) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setAt((i) => (i + 1) % SCENES.length), SCENE_MS);
    return () => clearInterval(timer);
  }, []);

  const scene = SCENES[at]!;

  return (
    /* the FRAME (corner, ground) and the CENTRING BOX are two elements: one
       element wearing a corner, a height, flex and centring together is the
       exact silhouette `control.guard` reads as a hand-rolled button, and
       this is a panel */
    <section aria-label={t("demoVideoLabel")} className="relative h-full overflow-hidden rounded-2xl bg-surface-2">
    <div className="flex min-h-[28rem] flex-col items-center justify-center p-8 text-center">
      <h2 className="text-2xl font-bold leading-tight text-fg">{t("demoHeadline")}</h2>
      {DEMO_VIDEO_SRC !== null ? (
        <video
          className="mt-6 w-full max-w-xl rounded-xl"
          src={DEMO_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          controls
        />
      ) : (
        <>
          <div className="mt-6 w-full max-w-md text-fg" aria-hidden>
            <scene.Scene />
          </div>
          {/* the sentence for the picture on screen — announced as it changes,
              because the picture itself says nothing to a screen reader */}
          <p className="mt-4 text-base leading-7 text-fg-muted" aria-live="polite">
            {t(`demo_${scene.key}`)}
          </p>
          <div className="mt-5 flex items-center gap-1.5">
            {SCENES.map((s, i) => (
              /* the DOT is a span inside the button, not the button: a
                 pressable with a fixed height and a corner is what
                 `control.guard` reads as a hand-rolled control, and this is
                 the reference's carousel dot — the emoji wells' precedent,
                 geometry on the glyph, the press on a plain box (which also
                 gives a finger more than six pixels to land on) */
              <button
                key={s.key}
                type="button"
                aria-label={t(`demo_${s.key}`)}
                aria-pressed={i === at}
                onClick={() => setAt(i)}
                className="tap p-1"
              >
                <span
                  aria-hidden
                  className={`block h-1.5 rounded-full transition-all ${i === at ? "w-6 bg-accent" : "w-1.5 bg-border-strong"}`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
    </section>
  );
}
