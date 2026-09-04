"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Projects } from "./Projects";
import { ProjectDetail } from "./ProjectDetail";

/**
 * The signed-in person's id, resolved once and handed to both project
 * surfaces (0181).
 *
 * A wrapper rather than a read inside each screen, and for a reason worth
 * writing down: «مال من» and the «شما» marker are both claims about WHO IS
 * READING, so a screen that renders before the identity lands must not treat
 * "not loaded yet" as "not me". `null` here means BOTH — which is honest
 * while it is loading and would be a bug if either surface drew a conclusion
 * from it. Neither does: the filter shows nothing for `null` rather than
 * everything, and the marker simply does not render.
 */
function useMeId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.me().then((me) => setId(me?.id ?? null)).catch(() => setId(null)); }, []);
  return id;
}

export function ProjectsScreen() {
  const meId = useMeId();
  return <Projects meId={meId} />;
}

export function ProjectScreen({ id }: { id: string }) {
  const meId = useMeId();
  return <ProjectDetail id={id} meId={meId} />;
}
