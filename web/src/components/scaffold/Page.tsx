import type { ReactNode } from "react";

/**
 * M26 scaffold — the content column and the page's head.
 *
 * Pages never hand-roll layout: a screen is PageContainer → PageHeader →
 * Section(s), and the sizes live in the classes HERE (backed by
 * scaffold/constants.ts through the Tailwind theme). A page that wants a
 * different gap changes the blueprint, not itself.
 */

/**
 * The centered content column. `wide` is for data-dense surfaces (member
 * tables, audit logs, call lists) — the blueprint's 1600px variant; `full`
 * exists for editor-like surfaces and is deliberately rare.
 */
export function PageContainer({
  width = "default",
  children,
}: {
  width?: "default" | "wide" | "full";
  children: ReactNode;
}) {
  const max =
    width === "default" ? "max-w-content" : width === "wide" ? "max-w-content-wide" : "max-w-none";
  return <div className={`mx-auto w-full ${max} px-5 pb-16 pt-8 md:px-10 md:pt-12`}>{children}</div>;
}

/**
 * One 24px title, a muted 14px subtitle 4px under it, optional actions at
 * inline-end. Breadcrumbs are NOT here — the top bar's trail carries them
 * (one mechanism, the breadcrumb ruling).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A section block: 20px title, optional muted description, content 16px
 * below. Sections stack at a 24px rhythm; `divided` draws the hairline ABOVE
 * this section (the blueprint separates sections, not panels).
 */
export function Section({
  title,
  description,
  divided = false,
  children,
}: {
  title?: string;
  description?: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`py-6 first-of-type:pt-8 ${divided ? "border-t border-border" : ""}`}>
      {title ? <h2 className="text-xl font-semibold text-fg">{title}</h2> : null}
      {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
