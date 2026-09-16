/** Shipped media, not remote embeds. Both languages are rendered from the same scenes. */
export const PRODUCT_DEMOS = ["meeting", "ask", "tasks", "team", "connect"] as const;
export type ProductDemoId = (typeof PRODUCT_DEMOS)[number];

export function productDemoMedia(lesson: ProductDemoId, locale: string, theme: "light" | "dark" = "light") {
  const language = locale === "fa" ? "fa" : "en";
  const base = `/demo/${language}/${theme === "dark" ? "dark/" : ""}${lesson}`;
  return { src: `${base}.mp4`, poster: `${base}.jpg`, captions: `${base}.vtt`, language };
}
