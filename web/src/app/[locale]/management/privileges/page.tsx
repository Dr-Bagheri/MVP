"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { CapabilityState, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { FilterChips, FILTER_ROW_GAP } from "@/components/platform/sectionTabs";
import { IconGavel, IconUser } from "@/components/icons";
import { PageHeader, Skeleton } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { digits } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * audit finding, 2026-09-03: how many member rows the loading skeleton stands
 * in for. 0101's catalogue serves five member capabilities to every admin and
 * owner alike, so that group is STRUCTURE — known before the network. The
 * admin group is not reserved: whether it arrives at all depends on who is
 * asking, and a placeholder for a group that then never comes moves the layout
 * exactly the way an absent one does. Reserved space is a promise about the
 * size of what is coming; if the catalogue grows, this number is what keeps
 * the promise true.
 */
const MEMBER_ROWS = 5;

type Group = "member" | "admin";

/**
 * MEMBER PRIVILEGES (user directive, 2026-08-26; db/0101).
 *
 * WHAT THIS SCREEN CAN AND CANNOT DO — said on the screen as well as here,
 * because a security surface that overstates itself is worse than none.
 * Every switch NARROWS what a role may do. The database decides which rows
 * a person can see at all, and nothing here widens that. So "members may
 * delete their own records" is a real switch — the database allows it
 * today, and turning it off makes the server refuse first — while
 * "members may read everyone's records" is not offered and never will be,
 * because it would be a promise the database overrules.
 *
 * The hierarchy belongs to the database too (0101's policy). It is
 * mirrored here only so the screen greys what it cannot change rather than
 * offering a switch that will be refused: an admin binds MEMBERS, the
 * owner binds ADMINS, nobody binds the owner. That last one is the exit
 * D27 asks for — if an admin could bind admins, two of them could lock
 * this screen away and only a hand-written UPDATE would recover the org.
 *
 * ONE GROUP AT A TIME, chosen on the second row (user directive, 2026-09-05:
 * "second sub menu in Member privileges with two sections, members, admins,
 * with the same style that we made the rule"). The two groups were two cards
 * stacked on one scroll; they are the platform's row-two chips now — the
 * tasks page's folder strip, the security page's presence filter — and the
 * card under them shows the group that is lit. The ADMIN chip exists only
 * when the server sent admin rows: the filtering happens on the SERVER (an
 * admin's response simply has no admin rows in it — user directive,
 * 2026-08-26: "it does not feel right that an admin sees their own
 * privileges"), so this page offers whichever groups arrived rather than
 * deciding the question here. A component that hid data it had been sent
 * would be a curtain, not a wall.
 */
export default function PrivilegesPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  const [me, setMe] = useState<User | null>(null);
  const [state, setState] = useState<CapabilityState | null>(null);
  /* audit finding, 2026-09-03: `state === null` used to mean two things —
     "not answered yet" and "the read failed" — and once a skeleton stands in
     for the first, the second would keep it pulsing forever, reporting
     "loading" about a state that is not loading. A failed fetch is an answer;
     it gets its own flag so the screen can name which nothing it is showing. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>("member");

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    setLoadFailed(false);
    void api
      .capabilities()
      .then(setState)
      .catch(() => {
        setState(null);
        setLoadFailed(true);
      });
  }, [isAdmin]);

  /** absent means ALLOWED — the table records decisions, not permissions */
  const allowed = (role: string, key: string): boolean =>
    state?.decisions.find((d) => d.role === role && d.capability === key)?.allowed ?? true;

  async function toggle(role: Group, key: string, next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      setState(await api.setCapability(role, key, next));
    } catch {
      /* the server refuses what the hierarchy forbids; the screen says so
         rather than leaving a switch that moved and changed nothing */
      notify(t("privilegeFailed"), "warn");
      const fresh = await api.capabilities().catch(() => null);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  }

  if (me && !isAdmin) {
    return (
      <ManagementPane activeSlug="privileges">
        <PageHeader title={t("section.privileges")} subtitle={t("desc.privileges")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
        </Card>
      </ManagementPane>
    );
  }

  /* the groups the server sent — the member group is structure and is offered
     before the network answers; the admin group only once it has arrived */
  const groups: readonly Group[] = state === null
    ? ["member"]
    : (["member", "admin"] as const).filter((role) => state.capabilities.some((cap) => cap.role === role));
  const shown: Group = groups.includes(group) ? group : "member";
  const editable = shown === "member" || (state?.may_set_admin ?? false);
  const rows = state === null ? [] : state.capabilities.filter((cap) => cap.role === shown);

  return (
    <ManagementPane activeSlug="privileges">
      <PageHeader title={t("section.privileges")} subtitle={t("desc.privileges")} />

      {/* THE SCOPE NOTE LEFT THE SCREEN (user directive, 2026-09-02: "remove
          the first box"). The sentence — every switch narrows, nothing here
          widens, the database decides visibility — is still true and still
          the rule; it lives in this file's header and in db/0101 rather than
          as a card above the switches. A screen that opens with a paragraph
          about what it cannot do buries the switches it is for. */}

      <FilterChips
        label={t("section.privileges")}
        active={shown}
        onSelect={setGroup}
        className={FILTER_ROW_GAP}
        chips={groups.map((role) => ({
          key: role,
          label: t(`privilegeGroup_${role}`),
          icon: role === "member" ? <IconUser width={12} height={12} /> : <IconGavel width={12} height={12} />,
          /* the count arrives with the rows — undefined until then, never a «۰»
             that reads as "no privileges" while the read is in flight */
          count: state === null
            ? undefined
            : digits(state.capabilities.filter((cap) => cap.role === role).length, locale),
        }))}
      />

      {/* audit finding, 2026-09-03: `state` is null until capabilities()
          answers (and that fetch waits on identity first), so the page was the
          heading followed by empty space until the rows dropped in — loading
          and "nothing arrived" as one picture. The member card's frame is
          known before the network, so it stands first with the rows' geometry
          inside it and only the words wait. */}
      {state === null ? (
        loadFailed ? (
          <Card>
            <p className="text-sm text-fg-muted">{t("privilegeLoadFailed")}</p>
          </Card>
        ) : (
          <Card>
            {/* busy on the container, hidden on the leaves (every Skeleton sets
                its own aria-hidden) — the platform's idiom; aria-hidden on the
                busy element itself would take the announcement out of the
                tree along with the placeholders */}
            <ul className="divide-y divide-border" aria-busy="true">
              {Array.from({ length: MEMBER_ROWS }, (_, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3">
                  <span className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="mt-3 h-3 w-2/3" />
                  </span>
                  <Skeleton className="h-4 w-14 shrink-0" />
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : (
        <Card>
          {/* the one sentence the admin group may carry: whose hand it takes */}
          {editable ? null : (
            <p className="mb-1 text-xs text-fg-subtle">{t("privilegeOwnerOnly")}</p>
          )}
          <ul className="divide-y divide-border">
            {rows.map((cap) => (
              <li key={cap.key} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">
                    {t(`privilege_${cap.key.replace(".", "_")}`)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-fg-muted">
                    {t(`privilegeHint_${cap.key.replace(".", "_")}`)}
                  </span>
                </span>
                <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={allowed(shown, cap.key)}
                    disabled={busy || !editable}
                    aria-label={t(`privilege_${cap.key.replace(".", "_")}`)}
                    onChange={(e) => void toggle(shown, cap.key, e.target.checked)}
                  />
                  {allowed(shown, cap.key) ? t("privilegeOn") : t("privilegeOff")}
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </ManagementPane>
  );
}
