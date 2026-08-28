"use client";

import { use } from "react";
import { IntegrationDetail } from "@/components/platform/IntegrationDetail";

/** One integration's own page — /integrations/gmail, /integrations/google-drive, … */
export default function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <IntegrationDetail slug={slug} />;
}
