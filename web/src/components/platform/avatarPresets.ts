/**
 * EIGHT READY-MADE AVATARS (user, 2026-09-17: "add 8 avatar images, 5 girls
 * and 3 boys, animated, for them to select as a profile image").
 *
 * Drawn here as inline SVG strings, in the flat illustrated style the
 * product already uses for its brand marks — no remote asset under the CSP,
 * no binary in the repo, and a picture that scales to whatever the Avatar
 * asks for. Picking one goes through the SAME path a photo does: the SVG is
 * rasterised to the 256×256 JPEG the crop step produces, shown in the
 * accept card, and uploaded only on the person's accept — one image, seen
 * then sent (AvatarEditor's own rule).
 *
 * The order is five women, then three men; a caller labels them by index
 * («آواتار ۱» …), so the order is part of the contract.
 */
export type AvatarPreset = { key: string; svg: string };

type Palette = { bg: string; skin: string; hair: string; shirt: string; ink?: string };

const INK = "#2B1B12";

/** the pieces every face shares, in paint order: ground, shoulders, neck, then whatever the caller puts behind and over the head */
function face(p: Palette, behind: string, over: string, opts: { neck?: boolean; mouth?: string } = {}): string {
  const ink = p.ink ?? INK;
  const neck = opts.neck === false ? "" : `<rect x="27" y="34" width="10" height="13" rx="4" fill="${p.skin}"/>`;
  const mouth = opts.mouth ?? `<path d="M28 32.5 Q32 36 36 32.5" stroke="#8A4B3A" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">`,
    `<rect width="64" height="64" fill="${p.bg}"/>`,
    `<path d="M10 64 C10 50 20 45 32 45 C44 45 54 50 54 64 Z" fill="${p.shirt}"/>`,
    neck,
    behind,
    `<circle cx="19.5" cy="28" r="2.5" fill="${p.skin}"/><circle cx="44.5" cy="28" r="2.5" fill="${p.skin}"/>`,
    `<circle cx="32" cy="27" r="13" fill="${p.skin}"/>`,
    `<circle cx="24.5" cy="31.5" r="2" fill="#F08A8A" opacity=".45"/><circle cx="39.5" cy="31.5" r="2" fill="#F08A8A" opacity=".45"/>`,
    `<circle cx="27" cy="27.5" r="1.7" fill="${ink}"/><circle cx="37" cy="27.5" r="1.7" fill="${ink}"/>`,
    `<path d="M24.5 23.5 Q27 22 29.5 23.5" stroke="${p.hair}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    `<path d="M34.5 23.5 Q37 22 39.5 23.5" stroke="${p.hair}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
    mouth,
    over,
    `</svg>`,
  ].join("");
}

const FRINGE = (hair: string) =>
  `<path d="M19 27 C19 14 45 14 45 27 C42 21 37 19 32 19 C27 19 22 21 19 27 Z" fill="${hair}"/>`;

const f1: Palette = { bg: "#FBE4E8", skin: "#F4C8A8", hair: "#3B2418", shirt: "#E9707A" };
const f2: Palette = { bg: "#DDEEFB", skin: "#E9B88F", hair: "#9A4A24", shirt: "#4E8FD6" };
const f3: Palette = { bg: "#E4F4E6", skin: "#A9693F", hair: "#1C1C1C", shirt: "#2FA37A" };
const f4: Palette = { bg: "#FFF0D5", skin: "#F5D6BE", hair: "#D8A03E", shirt: "#F0A03A" };
const f5: Palette = { bg: "#ECE6FA", skin: "#D9A184", hair: "#4A3A8F", shirt: "#5B4BB5" };
const m1: Palette = { bg: "#DCEBFA", skin: "#F0C6A6", hair: "#2B1B12", shirt: "#3568C4" };
const m2: Palette = { bg: "#D9F3E5", skin: "#C68642", hair: "#1A1A1A", shirt: "#2F8F6E" };
const m3: Palette = { bg: "#FFE7C2", skin: "#E6B58F", hair: "#5A331A", shirt: "#C9702B" };

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  /* 1 — long straight hair */
  { key: "f-long", svg: face(f1,
    `<path d="M17 28 C17 10 47 10 47 28 L47 48 L40 48 L40 30 L24 30 L24 48 L17 48 Z" fill="${f1.hair}"/>`,
    FRINGE(f1.hair)) },
  /* 2 — auburn bob */
  { key: "f-bob", svg: face(f2,
    `<path d="M18 28 C18 10 46 10 46 28 L46 40 C46 43 43 44 41 44 L23 44 C21 44 18 43 18 40 Z" fill="${f2.hair}"/>`,
    `<path d="M19 27 C19 14 45 14 45 27 C44 22 40 19 34 19 C29 19 22 22 19 27 Z" fill="${f2.hair}"/>`) },
  /* 3 — black curls */
  { key: "f-curly", svg: face(f3,
    `<circle cx="32" cy="22" r="16" fill="${f3.hair}"/><circle cx="18" cy="30" r="6" fill="${f3.hair}"/><circle cx="46" cy="30" r="6" fill="${f3.hair}"/><circle cx="20" cy="38" r="5" fill="${f3.hair}"/><circle cx="44" cy="38" r="5" fill="${f3.hair}"/>`,
    `<circle cx="24" cy="17" r="4" fill="${f3.hair}"/><circle cx="32" cy="15" r="4.5" fill="${f3.hair}"/><circle cx="40" cy="17" r="4" fill="${f3.hair}"/>`) },
  /* 4 — blonde bun */
  { key: "f-bun", svg: face(f4,
    `<circle cx="32" cy="11" r="5.5" fill="${f4.hair}"/><path d="M19 28 C19 12 45 12 45 28 L45 34 L19 34 Z" fill="${f4.hair}"/>`,
    FRINGE(f4.hair)) },
  /* 5 — a headscarf */
  { key: "f-scarf", svg: face(f5,
    `<path d="M16 30 C16 10 48 10 48 30 L48 50 C48 53 44 54 40 54 L24 54 C20 54 16 53 16 50 Z" fill="${f5.shirt}"/>`,
    `<path d="M19 27 C19 14 45 14 45 27 C42 21 37 19 32 19 C27 19 22 21 19 27 Z" fill="${f5.shirt}"/>`,
    { neck: false }) },
  /* 6 — short dark hair */
  { key: "m-short", svg: face(m1, "",
    `<path d="M19 27 C19 13 45 13 45 27 C44 21 39 18 32 18 C25 18 20 21 19 27 Z" fill="${m1.hair}"/>`) },
  /* 7 — short hair and a beard */
  { key: "m-beard", svg: face(m2, "",
    `<path d="M19 27 C19 13 45 13 45 27 C44 21 39 18 32 18 C25 18 20 21 19 27 Z" fill="${m2.hair}"/><path d="M20 31 C20 46 44 46 44 31 C44 38 39 41.5 32 41.5 C25 41.5 20 38 20 31 Z" fill="${m2.hair}"/>`) },
  /* 8 — curls and glasses */
  { key: "m-afro", svg: face(m3,
    `<circle cx="32" cy="24" r="17.5" fill="${m3.hair}"/>`,
    `<circle cx="27" cy="27.5" r="4.2" fill="none" stroke="${INK}" stroke-width="1.3"/><circle cx="37" cy="27.5" r="4.2" fill="none" stroke="${INK}" stroke-width="1.3"/><path d="M31.2 27.5 L32.8 27.5" stroke="${INK}" stroke-width="1.3"/>`) },
];
