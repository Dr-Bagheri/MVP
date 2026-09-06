import type { ReactElement, ReactNode } from "react";

/**
 * THE PROVIDERS' OWN MARKS (user directive, 2026-09-06: the integrations page
 * "like an app store … with their own logos").
 *
 * Inline SVG, one component per integration, and nothing fetched: the page's
 * CSP admits no remote brand asset, and a logo that arrives from a CDN is a
 * logo that is sometimes a broken image. The paths are the marks as published
 * in the open svgl library (svgl.app), trimmed of the wrappers that did
 * nothing here — a `clipPath` the size of its own canvas, `width`/`height`
 * attributes the box overrides.
 *
 * Every mark is drawn into ONE square box (`className` sizes it, the viewBox
 * keeps each mark's own aspect inside it) so four different logos sit on one
 * baseline across a row of tiles. `data-brand` names the mark so a test can
 * ask for THIS logo rather than for "an svg".
 *
 * The marks are decorative — the tile's name is beside them — so each is
 * `aria-hidden`. A slug with no mark renders the caller's `fallback` (the
 * house line icon), which is how a provider the offer does not carry today
 * (Microsoft) keeps a face without a second copy of its brand kit here.
 */
type MarkProps = { className: string; slug: string };

function box({ className, slug }: MarkProps, viewBox: string, children: ReactNode): ReactElement {
  return (
    <svg
      viewBox={viewBox}
      className={`${className} shrink-0`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
      data-brand={slug}
    >
      {children}
    </svg>
  );
}

const MARKS: Readonly<Record<string, (props: MarkProps) => ReactElement>> = {
  gmail: (p) =>
    box(p, "0 49.4 512 399.42", (
      <g fill="none" fillRule="evenodd">
        <g fillRule="nonzero">
          <path fill="#4285f4" d="M34.91 448.818h81.454V251L0 163.727V413.91c0 19.287 15.622 34.91 34.91 34.91z" />
          <path fill="#34a853" d="M395.636 448.818h81.455c19.287 0 34.909-15.622 34.909-34.909V163.727L395.636 251z" />
          <path fill="#fbbc04" d="M395.636 99.727V251L512 163.727v-46.545c0-43.142-49.25-67.782-83.782-41.891z" />
        </g>
        <path fill="#ea4335" d="M116.364 251V99.727L256 204.455 395.636 99.727V251L256 355.727z" />
        <path fill="#c5221f" fillRule="nonzero" d="M0 117.182v46.545L116.364 251V99.727L83.782 75.291C49.25 49.4 0 74.04 0 117.18z" />
      </g>
    )),
  "google-calendar": (p) =>
    box(p, "0 0 512 512", (
      <>
        <path d="M390.736 121.264H121.264V390.736H390.736V121.264Z" fill="#ffffff" />
        <path d="M390.736 512L512 390.736L451.368 380.392L390.736 390.736L379.67 446.196L390.736 512Z" fill="#EA4335" />
        <path d="M0 390.736V471.578C0 493.912 18.088 512 40.42 512H121.264L133.714 451.368L121.264 390.736L55.198 380.392L0 390.736Z" fill="#188038" />
        <path d="M512 121.264V40.42C512 18.088 493.912 0 471.58 0H390.736C383.36 30.072 379.671 52.2027 379.67 66.392C379.67 80.58 383.359 98.8707 390.736 121.264C417.556 128.944 437.767 132.784 451.368 132.784C464.969 132.784 485.18 128.945 512 121.264Z" fill="#1967D2" />
        <path d="M512 121.264H390.736V390.736H512V121.264Z" fill="#FBBC04" />
        <path d="M390.736 390.736H121.264V512H390.736V390.736Z" fill="#34A853" />
        <path d="M390.736 0H40.422C18.088 0 0 18.088 0 40.42V390.736H121.264V121.264H390.736V0Z" fill="#4285F4" />
        <path d="M176.54 330.308C166.468 323.504 159.494 313.568 155.688 300.428L179.066 290.796C181.186 298.88 184.891 305.145 190.182 309.592C195.436 314.038 201.836 316.228 209.314 316.228C216.959 316.228 223.527 313.903 229.018 309.254C234.51 304.606 237.272 298.678 237.272 291.504C237.272 284.16 234.375 278.164 228.582 273.516C222.788 268.868 215.512 266.544 206.822 266.544H193.314V243.404H205.44C212.917 243.404 219.216 241.382 224.336 237.338C229.456 233.298 232.016 227.772 232.016 220.732C232.016 214.468 229.726 209.482 225.146 205.744C220.566 202.004 214.77 200.118 207.73 200.118C200.858 200.118 195.402 201.938 191.36 205.608C187.319 209.289 184.282 213.937 182.534 219.116L159.394 209.482C162.458 200.792 168.084 193.112 176.336 186.476C184.588 179.84 195.132 176.506 207.932 176.506C217.398 176.506 225.92 178.326 233.466 181.996C241.01 185.668 246.938 190.754 251.216 197.222C255.496 203.722 257.616 210.998 257.616 219.082C257.616 227.334 255.63 234.308 251.656 240.034C247.682 245.76 242.796 250.138 237.002 253.204V254.584C244.483 257.669 250.982 262.735 255.798 269.238C260.682 275.806 263.142 283.654 263.142 292.818C263.142 301.978 260.816 310.164 256.168 317.338C251.52 324.514 245.088 330.172 236.934 334.282C228.75 338.392 219.554 340.482 209.348 340.482C197.524 340.514 186.612 337.112 176.54 330.308ZM320.132 214.298L294.466 232.858L281.632 213.39L327.678 180.176H345.328V336.842H320.132V214.298Z" fill="#4285F4" />
      </>
    )),
  "google-drive": (p) =>
    box(p, "0 0 87.3 78", (
      <>
        <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" />
        <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
        <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" />
        <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
        <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
        <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
      </>
    )),
  "google-meet": (p) =>
    box(p, "0 0 622 512", (
      <>
        <path d="M351.419 255.568L411.978 324.79L493.418 376.827L507.584 256.005L493.418 137.908L410.418 183.621L351.419 255.568Z" fill="#00832D" />
        <path d="M0.00283051 365.583V468.541C0.00283051 492.049 19.0851 511.136 42.5983 511.136H145.556L166.876 433.344L145.556 365.583L74.9198 344.263L0.00283051 365.583Z" fill="#0066DA" />
        <path d="M145.556 -7.62939e-06L0.00283051 145.554L74.9247 166.822L145.556 145.554L166.488 78.7145L145.556 -7.62939e-06Z" fill="#E94235" />
        <path d="M0.00526047 365.629H145.556V145.551H0.00526047V365.629Z" fill="#2684FC" />
        <path d="M586.398 61.6293L493.416 137.91V376.827L586.782 453.404C600.758 464.352 621.204 454.374 621.204 436.607V78.0861C621.204 60.1224 600.271 50.193 586.396 61.6317" fill="#00AC47" />
        <path d="M351.419 255.568V365.583H145.556V511.136H450.825C474.338 511.136 493.418 492.049 493.418 468.541V376.827L351.419 255.568Z" fill="#00AC47" />
        <path d="M450.825 -7.62939e-06H145.556V145.554H351.419V255.568L493.42 137.905V42.5979C493.42 19.0847 474.338 0.00241891 450.825 0.00241891" fill="#FFBA00" />
      </>
    )),
};

/** the slugs that have a mark of their own — the test derives its expectations from this */
export const BRAND_MARK_SLUGS: readonly string[] = Object.keys(MARKS);

export function BrandMark({
  slug,
  className,
  fallback = null,
}: {
  /** the catalogue's slug (`gmail`, `google-calendar`, …) */
  slug: string;
  /** the square box the mark is drawn into, e.g. `h-10 w-10` */
  className: string;
  /** what to draw for a slug with no mark of its own */
  fallback?: ReactNode;
}): ReactElement | null {
  const draw = MARKS[slug];
  if (!draw) return <>{fallback}</>;
  return draw({ slug, className });
}
