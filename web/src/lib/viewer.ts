"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Role } from "@/api/types";

/**
 * WHO IS LOOKING — for CHROME only.
 *
 * The menus offered what the viewer could not open. A member saw Management ·
 * member access, invitations and users in the sub-menu, pressed one, and got
 * a card telling them it is for admins — the page has refused since it
 * shipped, and the server refuses under that, so nothing was ever exposed;
 * what was wrong is that the product advertised four doors and opened one.
 * (User directive, 2026-09-18: "make member access invisible to the member
 * roles".)
 *
 * ── this is a CURTAIN, and it is allowed to be one ────────────────────────
 * Every rule this hook draws is enforced twice underneath: the page renders
 * an admin-only card, and core/ + RLS refuse the read. So a stale or wrong
 * answer here costs a menu entry, never a row. That is exactly why it may be
 * seeded from `sessionStorage` below, and why nothing in this file is allowed
 * to become the only thing standing between a member and a surface.
 *
 * ── three states, and the middle one is the reason this file exists ───────
 * `undefined` is STILL ASKING; `null` is there is nobody (the guest door, the
 * auth pages). Collapsing them is what made the bell appear only after the
 * network on 2026-09-08, and it would here make every menu render its
 * member-shaped version for a frame and then grow — the jump the rail's foot
 * card was fixed for on the same day.
 *
 * So the answer is remembered PER TAB: after the first load of a session the
 * menu is correct on the very first paint, with no fetch to wait for. The
 * first load ever is the only one that resolves late, and a role that changed
 * since it was cached corrects itself when the fetch lands a moment later.
 */

const KEY = "neurai.viewer.role";

/** Writes never throw the page down: private windows and blocked site data. */
function remembered(): Role | null | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return undefined;
    return raw === "" ? null : (raw as Role);
  } catch {
    return undefined;
  }
}

function remember(role: Role | null): void {
  try {
    sessionStorage.setItem(KEY, role ?? "");
  } catch {
    /* a tab that cannot remember simply asks again */
  }
}

export function useViewerRole(): Role | null | undefined {
  /*
   * Seeded in the INITIALISER rather than an effect: read it after the first
   * render and the first paint is already the wrong menu, which is the whole
   * failure this is avoiding.
   */
  const [role, setRole] = useState<Role | null | undefined>(() => remembered());

  useEffect(() => {
    let live = true;
    void api
      .me()
      .then((me) => {
        if (!live) return;
        const next = me?.role ?? null;
        setRole(next);
        remember(next);
      })
      .catch(() => {
        /* A failed identity read is NOT "there is nobody": reporting it as
           null would empty an admin's menu on a network blip. It leaves the
           state as it was — remembered, or still asking. */
      });
    return () => { live = false; };
  }, []);

  return role;
}

/** Admin or owner. One spelling, because three files were comparing by hand. */
export function isAdminRole(role: Role | null | undefined): boolean {
  return role === "admin" || role === "owner";
}
