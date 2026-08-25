"use client";

import { useTranslations } from "next-intl";
import { IconGauge, IconRows, IconUsers } from "@/components/icons";
import { SectionMenu } from "@/components/scaffold";

/**
 * The DASHBOARD's own section menu (user directive, 2026-08-25: "remove
 * assistant from the dashboard sub menu").
 *
 * The assistant's destinations live on the assistant's page; this menu
 * names where the dashboard's own numbers come from — the records they are
 * derived from, and the people behind them. Two doors, both real.
 */
export function DashboardMenu() {
  const tDash = useTranslations("dashboard");
  const tEcho = useTranslations("echo");

  return (
    <SectionMenu
      navLabel={tDash("title")}
      heading={tDash("title")}
      activeSlug="dashboard"
      groups={[
        {
          key: "overview",
          title: tDash("title"),
          items: [{
            slug: "dashboard",
            href: "/",
            label: tDash("board"),
            icon: <IconGauge />,
          }],
        },
        {
          key: "sources",
          title: tDash("sources"),
          items: [
            {
              slug: "records",
              href: "/echo/records",
              label: tEcho("section.records"),
              icon: <IconRows />,
            },
            {
              slug: "speakers",
              href: "/echo/speakers",
              label: tEcho("section.speakers"),
              icon: <IconUsers />,
            },
          ],
        },
      ]}
    />
  );
}
