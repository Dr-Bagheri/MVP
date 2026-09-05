"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthSessionRow, OrgSessionRow, User } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import { notify } from "@/lib/notify";
import { DataTable, StatusDot } from "@/components/DataTable";
import { IconClose, IconMoon, IconPeople3, IconPulse } from "@/components/icons";
import { Chip, EmptyState } from "@/components/ui";
import { FilterChips } from "./sectionTabs";
import { digits, formatDate, formatTime, personName } from "@/lib/format";
import { useLocale } from "next-intl";
import { signOutThisDevice } from "@/lib/signOut";

/**
 * Settings · Security (db/0112 batch).
 *
 * What is REAL here and where it comes from:
 *  - ACTIVE SESSIONS: the caller's own rows from auth.sessions through a
 *    definer door whose select list is the wall — device, ip, times, a
 *    display handle. Sign-in HISTORY is deliberately absent: the auth
 *    audit table is empty on this deployment, and an empty list rendered
 *    as "no history" would be absent-because-unrecorded wearing
 *    absent-because-quiet.
 *  - VOICE PRINT: consent's other half. Enrollment recorded who and when;
 *    withdrawal is self-service here — one click, no admin, gone.
 *  - Password and provider management keep their single homes (Profile,
 *    Sign-in methods) and are LINKED, never duplicated.
 */
export function SecuritySettings() {
  const t = useTranslations("security");
  const locale = useLocale();
  /*
   * The caller's own devices, in three answers (2026-09-03).
   *
   * `null` = still asking, and the table renders its frame with skeleton rows.
   * `"unreadable"` = asked, and the read failed — which USED to be spelled
   * `[]`, so a failed request rendered «نشستی ثبت نشده است»: a sentence that
   * cannot be true, since the person reading it is signed in on the device
   * they are reading it on. An empty array now means only what it says.
   */
  const [sessions, setSessions] = useState<AuthSessionRow[] | null | "unreadable">(null);
  /** the handle of the session THIS request rode — the "this device" chip */
  const [current, setCurrent] = useState<string | null>(null);
  /** the session a right-click chose to end; the popup is the consent */
  const [ending, setEnding] = useState<AuthSessionRow | null>(null);
  const [endBusy, setEndBusy] = useState(false);

  /*
   * THE ORG'S SESSIONS (db/0135) — admin and owner only.
   *
   * `null` is "not asked or not permitted" and renders nothing at all; an
   * empty array is "asked, and this org has none". Keeping them apart is
   * what stops a member's screen from showing an empty security table that
   * reads as "nobody in this company is signed in".
   */
  const [orgSessions, setOrgSessions] = useState<OrgSessionRow[] | null | "refused">(null);
  const [endingOrg, setEndingOrg] = useState<OrgSessionRow | null>(null);
  /** the second sub-menu (user, 2026-09-05): all | online | offline */
  const [presence, setPresence] = useState<"all" | "online" | "offline">("all");

  useEffect(() => {
    void api.mySessions()
      .then((answer) => { setSessions(answer.sessions); setCurrent(answer.current); })
      /* a failure is an answer, just not one about this person's devices */
      .catch(() => setSessions("unreadable"));
  }, []);

  useEffect(() => {
    /*
     * Asked unconditionally and REFUSED for a member, rather than gated on a
     * role this component would have to fetch. The wall answers in one round
     * trip either way, and a client-side gate here would be a third copy of
     * a rule the API and the database already hold — the copy that drifts.
     * A refusal simply leaves the section unrendered.
     */
    void api.orgSessions()
      .then(setOrgSessions)
      /* REFUSED, not "still loading" — the two were the same value here, so a
         member's page waited forever on an answer that had already come back
         as no. The distinction is what lets the section fall back to this
         person's own devices instead of rendering an empty frame. */
      .catch(() => setOrgSessions("refused"));
  }, []);


  /*
   * Browser + platform, read from the user agent — two words, because
   * "Edge" alone cannot tell a person which of their machines a row is.
   * Order matters twice: Edge's UA contains "Chrome", Chrome's contains
   * "Safari"; the specific brand is asked first each time.
   */
  const agentLabel = (agent: string | null): string => {
    if (!agent) return t("deviceUnknown");
    const browser = /edg/i.test(agent) ? "Edge"
      : /firefox/i.test(agent) ? "Firefox"
      : /chrome|crios/i.test(agent) ? "Chrome"
      : /safari/i.test(agent) ? "Safari"
      : t("deviceBrowser");
    const platform = /windows/i.test(agent) ? "Windows"
      : /iphone|ipad|ios/i.test(agent) ? "iOS"
      : /android/i.test(agent) ? "Android"
      : /mac os|macintosh/i.test(agent) ? "macOS"
      : /linux/i.test(agent) ? "Linux"
      : null;
    return platform ? `${browser} · ${platform}` : browser;
  };

  const everyone = Array.isArray(orgSessions) ? orgSessions : [];
  const onlineCount = everyone.filter((session) => session.online).length;

  return (
    <div className="space-y-5">
      {/*
        The password/sign-in/export rows LEFT this page (user directive,
        2026-08-28: "remove this first section of security") — all three
        were doors to pages the menu already reaches, and a security page
        that opens with three link-buttons buries the two things only it
        has: the live devices and the voice print.
      */}

      {/*
        ONE SESSIONS SECTION (user directive, 2026-09-02: "remove the second
        section in the sessions and in first show all online sessions from
        everywhere connected to our platform").

        There were two, stacked: this person's devices, then everyone's. For
        an admin that is the same list twice, with their own rows in both —
        which is why it read as a duplicate rather than as two questions.

        What is rendered depends on the WALL, not on a role this component
        fetched: the org-wide read is asked for unconditionally and refused
        for a member (db/0135), so an admin gets everybody and a member gets
        their own devices. Neither sees an empty frame, and there is no
        third copy of the rule here to drift from the other two.
      */}
      {/* ── everyone's devices, for an admin or owner (db/0135) ───────── */}
      {orgSessions !== "refused" ? (
      <div>
          {/* NO TITLE, and the tasks page's own second row above the table
              (user, 2026-09-05: "remove the title همهٔ اعضای سازمان, add the
              second sub menu in the same style as the tasks, with all |
              online | offline"). The menu above already names the page; the
              row answers the one question this table gets asked. */}
          <FilterChips
            label={t("colOnline")}
            active={presence}
            onSelect={setPresence}
            className="mb-5"
            chips={[
              { key: "all", label: t("filterAll"), icon: <IconPeople3 width={12} height={12} />, count: digits(everyone.length, locale) },
              { key: "online", label: t("onlineYes"), icon: <IconPulse width={12} height={12} />, count: digits(onlineCount, locale) },
              { key: "offline", label: t("onlineNo"), icon: <IconMoon width={12} height={12} />, count: digits(everyone.length - onlineCount, locale) },
            ]}
          />
          {/* rendered unconditionally so the frame stands before the answer;
              "no sessions" and "none match this filter" are the table's own
              empty node, never a sentence standing where the table would be */}
            <div>
              <DataTable
                loading={orgSessions === null}
                rows={Array.isArray(orgSessions)
                  ? orgSessions.filter((session) =>
                      presence === "all" || (presence === "online") === session.online)
                  : []}
                empty={<EmptyState text={t("orgSessionsEmpty")} />}
                rowKey={(session) => `${session.user_id}:${session.handle}`}
                /*
                 * The menu appears only where the wall says it may act. An
                 * admin sees the owner's session and gets NO end item on
                 * that row — the affordance mirrors the wall rather than
                 * offering a button that produces a refusal. `can_end` is
                 * the server's answer, never re-derived here.
                 */
                menuItems={(session) => session.can_end ? [{
                  key: "end",
                  label: t("endSession"),
                  icon: <IconClose width={14} height={14} />,
                  danger: true,
                  onSelect: () => setEndingOrg(session),
                }] : []}
                columns={[
                  {
                    key: "person",
                    header: t("colPerson"),
                    cell: (session) => (
                      <span className="font-medium text-fg">
                        {personName(session as unknown as User, locale)}
                      </span>
                    ),
                  },
                  {
                    key: "device",
                    header: t("colDevice"),
                    cell: (session) => (
                      <span className="flex items-center gap-2">
                        <span className="text-fg">{agentLabel(session.user_agent)}</span>
                        {session.handle === current ? (
                          <Chip tone="success">{t("thisDevice")}</Chip>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "online",
                    header: t("colOnline"),
                    headClassName: "whitespace-nowrap",
                    /* the same StatusDot the members list uses, so "online"
                       looks identical wherever it is said */
                    cell: (session) => (
                      <StatusDot
                        label={session.online ? t("onlineYes") : t("onlineNo")}
                        tone={session.online ? "success" : "muted"}
                      />
                    ),
                  },
                  {
                    key: "ip",
                    header: t("colIp"),
                    cell: (session) => (
                      <span dir="ltr" className="text-fg-muted">{session.ip ?? "—"}</span>
                    ),
                  },
                  {
                    key: "lastAction",
                    header: t("colLastAction"),
                    cell: (session) => session.refreshed_at ? (
                      <span className="text-fg-muted">
                        {`${formatDate(session.refreshed_at, locale)} ${formatTime(session.refreshed_at, locale)}`}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    ),
                  },
                ]}
              />
            </div>
      </div>
      ) : null}

      {ending ? (
        <ConfirmDialog
          title={t("endConfirmTitle", { device: agentLabel(ending.user_agent) })}
          body={t("endConfirmBody")}
          confirmLabel={t("endConfirm")}
          cancelLabel={t("cancel")}
          busy={endBusy}
          onCancel={() => setEnding(null)}
          onConfirm={() => {
            if (endBusy) return;
            setEndBusy(true);
            void api.endMySession(ending.handle)
              .then(() => {
                /* adopt the truth by re-reading, not by splicing: the door
                   may have refused (a race with the sweep) and the list is
                   the record */
                return api.mySessions().then((answer) => {
                  setSessions(answer.sessions);
                  setCurrent(answer.current);
                });
              })
              .then(() => { setEnding(null); notify(t("endDone")); })
              .catch(() => notify(t("endFailed"), "warn"))
              .finally(() => setEndBusy(false));
          }}
        />
      ) : null}

      {endingOrg ? (
        <ConfirmDialog
          title={t("endOrgConfirmTitle", {
            person: personName(endingOrg as unknown as User, locale),
          })}
          body={t("endOrgConfirmBody")}
          confirmLabel={t("endConfirm")}
          cancelLabel={t("cancel")}
          busy={endBusy}
          onCancel={() => setEndingOrg(null)}
          onConfirm={() => {
            if (endBusy) return;
            setEndBusy(true);
            void api.endMemberSession(endingOrg.user_id, endingOrg.handle)
              /* re-read rather than splice: the rank rule or a sweep may
                 have moved under us, and the list is the record */
              .then(() => api.orgSessions().then(setOrgSessions))
              .then(() => { setEndingOrg(null); notify(t("endDone")); })
              .catch(() => notify(t("endFailed"), "warn"))
              .finally(() => setEndBusy(false));
          }}
        />
      ) : null}

      {orgSessions === "refused" ? (
      <div>
        <h2 className="h-section">{t("sessionsTitle")}</h2>
        {sessions === "unreadable" ? (
          /* 2026-09-03: the third nothing, named. "We could not read your
             sessions" and "you have none" were one sentence, and only one of
             them can ever be true here. */
          <p className="mt-3 text-sm text-fg-muted">{t("sessionsUnreadable")}</p>
        ) : sessions !== null && sessions.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t("sessionsEmpty")}</p>
        ) : (
          /* the records table's own dress: the table lives in a Card (M42)
             — without it the rows float on the page background and the
             user rightly asked whether this was the same table */
          <div className="mt-3">
            <DataTable
              loading={sessions === null}
              rows={Array.isArray(sessions) ? sessions : []}
              rowKey={(session) => session.handle}
              /* the records table's own gesture: every action in the
                 right-click menu. Ending THIS device is deliberately not
                 offered here — that is sign-out, which the avatar menu
                 already owns, and a session ending itself mid-request
                 would look like a crash rather than a choice. */
              /* EVERY row answers the right-click (the user right-clicked
                 their own row and concluded the menu did not exist). THIS
                 device offers sign-out — the honest name for ending the
                 session you are riding, consumed from the avatar menu's own
                 flow — and any other device offers the end door. */
              menuItems={(session) => session.handle === current ? [{
                key: "signout",
                label: t("signOutDevice"),
                icon: <IconClose width={14} height={14} />,
                onSelect: () => { void signOutThisDevice(locale); },
              }] : [{
                key: "end",
                label: t("endSession"),
                icon: <IconClose width={14} height={14} />,
                danger: true,
                onSelect: () => setEnding(session),
              }]}
              columns={[
                {
                  key: "device",
                  header: t("colDevice"),
                  cell: (session) => (
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-fg">{agentLabel(session.user_agent)}</span>
                      {session.handle === current ? (
                        <Chip tone="success">{t("thisDevice")}</Chip>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "ip",
                  header: t("colIp"),
                  cell: (session) => (
                    <span dir="ltr" className="text-fg-muted">{session.ip ?? "—"}</span>
                  ),
                },
                {
                  /* only the CURRENT session carries one — the BFF reads it
                     off the request in hand; an old row's IP is often the
                     hosting provider's egress, and a city derived from it
                     would be a guess wearing a fact's costume */
                  key: "location",
                  header: t("colLocation"),
                  cell: (session) => (
                    <span className="text-fg-muted">{session.location ?? "—"}</span>
                  ),
                },
                {
                  key: "signedIn",
                  header: t("colSignedIn"),
                  cell: (session) => (
                    <span className="text-fg-muted">
                      {`${formatDate(session.created_at, locale)} ${formatTime(session.created_at, locale)}`}
                    </span>
                  ),
                },
                {
                  key: "lastAction",
                  header: t("colLastAction"),
                  cell: (session) => session.refreshed_at ? (
                    <span className="text-fg-muted">
                      {`${formatDate(session.refreshed_at, locale)} ${formatTime(session.refreshed_at, locale)}`}
                    </span>
                  ) : (
                    /* never refreshed is a fact, not a gap */
                    <span className="text-fg-subtle">—</span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>

      ) : null}

      {/*
        The voice-print block LEFT this page (user directive, 2026-08-28:
        "remove voice print") — a member's own print is still withdrawable
        through the speakers directory, where voices live; the wire
        (deleteMyVoiceprint) is untouched.
      */}
    </div>
  );
}
