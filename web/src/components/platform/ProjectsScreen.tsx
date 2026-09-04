"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Projects } from "./Projects";
import { ProjectDetail } from "./ProjectDetail";

/**
 * Who is reading, resolved once and handed to both project surfaces.
 *
 * A wrapper rather than a read inside each screen, and for a reason worth
 * writing down: «مال من», the «شما» marker and the admin-only controls are all
 * claims about WHO IS READING, so a screen that renders before the identity
 * lands must not treat "not loaded yet" as "not me" or as "not an admin".
 * `null`/`false` here mean BOTH — which is honest while it is loading and
 * would be a bug if either surface drew a conclusion from it. Neither does:
 * the filter shows nothing rather than everything, the marker does not
 * render, and the create button is absent rather than offered-and-refused.
 *
 * Erring toward ABSENT is the safe direction for a permission: a button that
 * appears late is a moment of surprise; a button that appears wrongly is a
 * refusal the person has to interpret.
 */
function useReader(): { meId: string | null; isAdmin: boolean } {
  const [reader, setReader] = useState<{ meId: string | null; isAdmin: boolean }>({
    meId: null, isAdmin: false,
  });
  useEffect(() => {
    void api.me()
      .then((me) => setReader({
        meId: me?.id ?? null,
        isAdmin: me?.role === "admin" || me?.role === "owner",
      }))
      .catch(() => setReader({ meId: null, isAdmin: false }));
  }, []);
  return reader;
}

export function ProjectsScreen() {
  const { meId, isAdmin } = useReader();
  return <Projects meId={meId} isAdmin={isAdmin} />;
}

export function ProjectScreen({ id }: { id: string }) {
  const { meId, isAdmin } = useReader();
  return <ProjectDetail id={id} meId={meId} isAdmin={isAdmin} />;
}
