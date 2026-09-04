"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { OrgPersonRecord } from "@/api/types";
import { Chat } from "./Chat";

/**
 * The two reads every chat surface needs, resolved once: who is reading, and
 * the roster the mention picker and the author names come from.
 *
 * `null` for the identity means BOTH "still loading" and "nobody", and
 * neither the mention highlight nor the "you" marker may draw a conclusion
 * from it — so both simply do not render, which is honest while loading and
 * correct if there is genuinely nobody.
 */
export function ChatScreen() {
  const [meId, setMeId] = useState<string | null>(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  useEffect(() => {
    void api.me().then((me) => setMeId(me?.id ?? null)).catch(() => setMeId(null));
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);
  return <Chat meId={meId} people={people} />;
}
