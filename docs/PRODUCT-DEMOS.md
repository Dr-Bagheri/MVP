# Product introduction films

Shipped 2026-09-16 for the public login and first-time experience. The
presentation takes cues from Wispr Flow's focused input → outcome demos,
not its branding. NeurAI's own light-theme tokens and bundled Vazirmatn font
provide the visual language: cream ground, green emphasis, quiet depth.

These are **illustrative product animations with fictional example data**,
not screen captures of authenticated/customer sessions. UI is simplified
for legibility. No recording, invitation, authorization or model request is
performed while watching. No unsupported automatic action is promised.

## Films and source of truth

| Film | Shown | Implemented source |
| --- | --- | --- |
| Meetings | Recording → timestamped transcript → summary/next steps | `docs/SPEC.md`, `web/src/components/echo/Recorder.tsx`, `web/src/components/platform/meeting/Summary.tsx` |
| Assistant | Question → answer → meeting source | `web/src/components/platform/ConversationThread.tsx`, `AnswerBlocks.tsx` source links |
| Tasks | Owner/due date and manually moving a task to Done | `web/src/components/platform/TaskBoard.tsx`, `web/src/components/platform/tasks/TaskViews.tsx` |
| Team | Email invitation, Member role, pending acceptance | `web/src/app/[locale]/management/invitations/page.tsx` |
| Connections | Calendar connection, explicit consent, available events | `web/src/components/platform/Integrations.tsx`, `ConnectDialog.tsx`, `IntegrationDetail.tsx` |

Each film is 10 seconds, 1280×960, 24 fps, H.264/yuv420p MP4 with fast-start
metadata and no audio track. English and Persian have separate rendered
files, JPEG posters and WebVTT captions in `web/public/demo/{en,fa}/`.
Each language also has a `dark/` set. The shared theme preference switches
both the surrounding UI and the actual rendered film, not a CSS inversion.
The captions are also drawn into the film; text descriptions accompany the
player for non-visual access. The privacy question retains its existing
lock illustration instead of inventing a new privacy workflow.

## App integration

- `web/src/lib/productDemos.ts`: shared typed catalogue and locale paths.
- `web/src/components/onboarding/EntryTopBar.tsx`: platform-style public
  chrome with theme and same-page language choices; the onboarding stage
  tracker occupies its centre. The authenticated platform bar is unchanged.
- `web/src/components/onboarding/ProductDemo.tsx`: native playback controls,
  click-to-select playlist, reduced-motion/data-saver handling, visibility
  pause/resume, and non-blocking load-error/retry state.
- Login: five selectable clips on the left; login on the right in either
  locale. On a narrow screen, the form comes first and the clips follow.
- Onboarding: Meetings at welcome, Assistant at goals, Team at work, Tasks
  at places. All five clips are in the first-run lesson door on Home.
- Existing `NEXT_PUBLIC_DEMO_VIDEO_URL` remains an optional login-only
  override. Leave it unset for the bundled localized playlist. Overrides
  are user-started with native controls.

The playlist advances on video completion, never a wall-clock timer. Manual
pause keeps the selected film. Reduced-motion users see the real poster and
can play manually; their film does not auto-advance. Watching never blocks
sign-in or onboarding continuation. Clips leaving the viewport or a hidden
tab pause; a manually paused film does not resume on return.

## Rebuild

Runtime dependencies are unchanged. Rendering needs Node 22+, FFmpeg on
PATH, and `@napi-rs/canvas@0.1.80` only as an offline development tool.
The renderer reads the app's actual light-theme block and fails if absent.
For an isolated Windows installation:

```powershell
npm install --prefix "$env:TEMP/neurai-demo-render-tools" --no-audit --no-fund --ignore-scripts @napi-rs/canvas@0.1.80
$env:NEURAI_RENDER_MODULES = "$env:TEMP/neurai-demo-render-tools/node_modules"
node --experimental-strip-types scripts/render-product-demos.ts
node --experimental-strip-types scripts/render-product-demos.ts --theme=dark
```

Optional selectors: `--locale=fa`, `--scene=meeting`, `--theme=dark`, `--poster-only`.
`FFMPEG_PATH` can name an explicit executable. Re-render the poster, film and
captions together after changing copy or scenes. Review BOTH languages.

## Verification

`ProductDemo.test.tsx` reads shipped files (MP4/JPEG signatures, timed
captions), exercises selection, playback completion, reduced motion and
failure recovery. `FirstRunDoor.test.tsx` verifies selecting a film does not
write onboarding or start a real tour. Existing auth/onboarding tests cover
unchanged real workflows. Browser acceptance must inspect the actual video
decoder (`readyState`, duration, advancing currentTime), native pause/play,
and both locale layouts; a poster by itself is not proof of playback.

At acceptance on 2026-09-16, FFprobe verified all ten shipped MP4s as H.264,
yuv420p, 1280×960, 240 frames and 10.000 seconds. Files were approximately
175–315 KB each. There are no external trackers, stock clips or customer
assets. The media is reproducible from the committed TypeScript renderer.

The entry-chrome follow-up on the same date verified all twenty light/dark
language variants as 240-frame, 10-second H.264 files. Browser checks covered
Persian default routing, persisted dark arrival, a light-theme language
transition, playable locale/theme-matched media, and mobile header hit
targets. The onboarding header was also rendered as an isolated header
fixture at 375px and 1024px; the fixture was removed before the build.
The locale-root theme regression test was verified red by removing the
reapplication effect, then green after restoring it.
