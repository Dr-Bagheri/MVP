"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthSessionRow, OrgSessionRow, User } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import { notify } from "@/lib/notify";
import { DataTable } from "@/components/DataTable";
import { IconClose } from "@/components/icons";
import { Card, Chip } from "@/components/ui";
import { formatDate, formatTime, personName } from "@/lib/format";
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
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
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
  const [orgSessions, setOrgSessions] = useState<OrgSessionRow[] | null>(null);
  const [endingOrg, setEndingOrg] = useState<OrgSessionRow | null>(null);

  useEffect(() => {
    void api.mySessions()
      .then((answer) => { setSessions(answer.sessions); setCurrent(answer.current); })
      .catch(() => setSessions([]));
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
      .catch(() => setOrgSessions(null));
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

  return (
    <div className="space-y-5">
      {/*
        The password/sign-in/export rows LEFT this page (user directive,
        2026-08-28: "remove this first section of security") — all three
        were doors to pages the menu already reaches, and a security page
        that opens with three link-buttons buries the two things only it
        has: the live devices and the voice print.
      */}

      {/* ── the caller's own devices ─────────────────────────────────── */}
      <div>
        <h2 className="h-section">{t("sessionsTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("sessionsHint")}</p>
        {sessions === null ? null : sessions.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t("sessionsEmpty")}</p>
        ) : (
          /* the records table's own dress: the table lives in a Card (M42)
             — without it the rows float on the page background and the
             user rightly asked whether this was the same table */
          <Card className="mt-3 !p-0">
            <DataTable
              rows={sessions}
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
          </Card>
        )}
      </div>

      {/* ── everyone's devices, for an admin or owner (db/0135) ───────── */}
      {orgSessions === null ? null : (
        <div>
          <h2 className="h-section">{t("orgSessionsTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("orgSessionsHint")}</p>
          {orgSessions.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">{t("orgSessionsEmpty")}</p>
          ) : (
            <Card className="mt-3 !p-0">
              <DataTable
                rows={orgSessions}
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
            </Card>
          )}
        </div>
      )}

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

      {/*
        The voice-print block LEFT this page (user directive, 2026-08-28:
        "remove voice print") — a member's own print is still withdrawable
        through the speakers directory, where voices live; the wire
        (deleteMyVoiceprint) is untouched.
      */}
    </div>
  );
}
