"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { TelegramLinkRecord } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import { FormPanel, FormRow, PanelFooter, Skeleton } from "@/components/scaffold";
import { digits } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * Linking a Telegram account, so a voice note can become a card (db/0212).
 *
 * The screen is the whole security story made visible: a code appears here,
 * where the person is signed in, and it is the only thing that turns their
 * Telegram account into somebody the bot will act for. Nothing here is an
 * admin surface — a link is a fact about a personal messaging account, the
 * same posture as a voiceprint, and the server's policies scope every row to
 * the caller.
 *
 * ── THE CODE IS SHOWN ONCE ───────────────────────────────────────────────
 *
 * The column holds a SHA-256, so this component is the only place the
 * plaintext will ever exist. It stays on screen until the person leaves or
 * links; losing it means pressing the button again, which is a better
 * outcome than a code that can be read back forever.
 */
/*
 * The bot's handle comes from the SERVER, not from a prop.
 *
 * The first version took it as a prop and the profile page had nothing to
 * pass, so every colleague read «send it to your organisation's bot» — a
 * sentence with no way to act on it. `connector_connection` is owner-scoped,
 * so the handle needs db/0213's door; passing it down from a page that cannot
 * read it either was the producer-with-no-consumer shape at one remove.
 */
export function TelegramLink() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  /*
   * THREE STATES, because two of them are different kinds of nothing.
   *
   * `null` is "we have not asked yet" and `"unreadable"` is "we asked and
   * could not find out" — and the first version of this component collapsed
   * them, so a failed read left a skeleton turning forever. A screen that
   * looks like it is still loading, permanently, is its own lie: nobody
   * presses anything, and nothing says why.
   */
  const [link, setLink] = useState<TelegramLinkRecord | "unreadable" | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setLink(null);
      setLink(await api.telegramLink());
    } catch {
      /* NOT "not linked": that is a claim about somebody's account, and this
         is a fact about our request */
      setLink("unreadable");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mint() {
    setBusy(true);
    try {
      const minted = await api.mintTelegramCode();
      setCode(minted.code);
      await load();
    } catch (error) {
      notify(error instanceof BffError ? error.message : t("telegramCodeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await api.unlinkTelegram();
      setCode(null);
      await load();
    } catch (error) {
      notify(error instanceof BffError ? error.message : t("telegramUnlinkFailed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (link === null) {
    return <FormPanel><div className="p-5"><Skeleton className="h-16 w-full" /></div></FormPanel>;
  }

  if (link === "unreadable") {
    return (
      <FormPanel>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12.5px] leading-[1.9] text-fg-muted">{t("telegramUnreadable")}</p>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()}>
            {t("telegramRetry")}
          </button>
        </div>
      </FormPanel>
    );
  }

  return (
    <>
      <FormPanel>
        {link.linked ? (
          <FormRow label={t("telegramAccount")} controlAtEnd>
            <span className="text-sm text-fg">
              {link.telegram_username === null ? t("telegramLinked") : `@${link.telegram_username}`}
            </span>
          </FormRow>
        ) : (
          <div className="space-y-3 px-5 py-4">
            {/* a CONSEQUENCE, which is the kind of sentence R21 keeps: it says
                what pressing the button lets happen, before it is pressed, and
                there is nowhere else the person could learn it */}
            <p className="text-[12.5px] leading-[1.9] text-fg-muted">
              {link.bot_username !== null
                ? t("telegramHowTo", { bot: `@${link.bot_username}` })
                : t("telegramHowToNoBot")}
            </p>
            {code !== null ? (
              <div className="well flex items-center justify-between gap-3">
                {/* LTR and monospaced: the code is Latin letters and digits,
                    and on a Persian page a bidi-neutral run reorders them */}
                <code dir="ltr" className="font-mono text-lg tracking-[0.25em] text-fg">{code}</code>
                <span className="text-[11px] text-fg-subtle">
                  {t("telegramCodeExpires", { minutes: digits(15, locale) })}
                </span>
              </div>
            ) : null}
          </div>
        )}

        <PanelFooter>
          {link.linked ? (
            <button type="button" className="btn btn-danger" disabled={busy}
              onClick={() => setConfirming(true)}>
              {t("telegramUnlink")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mint()}>
              {code === null ? t("telegramMint") : t("telegramMintAgain")}
            </button>
          )}
        </PanelFooter>
      </FormPanel>

      {confirming ? (
        <ConfirmDialog
          title={t("telegramUnlinkTitle")}
          body={t("telegramUnlinkBody")}
          confirmLabel={t("telegramUnlink")}
          cancelLabel={tCommon("cancel")}
          busy={busy}
          onConfirm={() => void unlink()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
