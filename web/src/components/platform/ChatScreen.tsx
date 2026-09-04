"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { OrgPersonRecord } from "@/api/types";
import { Chat } from "./Chat";

/**
 * The three reads every chat surface needs, resolved once: who is reading,
 * whether they may hand out invitations, and the roster the mention picker
 * and the author names come from.
 *
 * `null`/`false` for the identity mean BOTH "still loading" and "nobody", and
 * neither the mention highlight, the "you" marker nor the invite button may
 * draw a conclusion from that. None does: the highlight simply does not
 * render, and the button is ABSENT rather than offered-and-refused. Erring
 * toward absent is the safe direction for a permission — a button that
 * appears late is a moment of surprise; one that appears wrongly is a refusal
 * the person has to interpret.
 */
export function ChatScreen() {
  const [meId, setMeId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  useEffect(() => {
    void api.me()
      .then((me) => {
        setMeId(me?.id ?? null);
        setIsAdmin(me?.role === "admin" || me?.role === "owner");
      })
      .catch(() => { setMeId(null); setIsAdmin(false); });
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);
  return <Chat meId={meId} isAdmin={isAdmin} people={people} />;
}
