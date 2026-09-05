"use client";

import { useState } from "react";
import { Select } from "@/components/Select";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { User } from "@/api/types";
import { Field } from "@/components/ui";
import { Dialog } from "./Dialog";
import { SecretOnce } from "./SecretOnce";

type Phase =
  | { step: "form" }
  /** The token exists here and nowhere else, for as long as this state lives. */
  | { step: "minted"; token: string; name: string };

/**
 * Mint (BFF.md §1, §3).
 *
 * Two things are decided here and can never be decided again:
 *
 * - **The token is shown once.** The dialog becomes non-dismissible the moment
 *   it arrives; `SecretOnce` owns the only exit.
 * - **`allow_assistant` is a decision AT MINT.** M17's amendment ratified a
 *   key's capabilities as immutable — core/ exposes create/list/revoke and no
 *   PATCH, deliberately, so that a key's meaning does not depend on when you
 *   looked at it. There is therefore no toggle in the list, and this checkbox
 *   is the only place the choice is ever offered. It defaults OFF because an
 *   assistant-capable key spends model tokens at machine speed and v1 ships no
 *   rate limiter.
 * - **Acts-as is a REQUIRED choice, deliberately unlike the API.** core/
 *   defaults `actor_id` to the creating admin, which is a sensible API default
 *   and a poor UI one: an admin who never thinks about it mints a key carrying
 *   *admin* authority, and nothing on screen says so. Since a key can do
 *   exactly what its actor can do, defaulting the actor defaults the key's
 *   power — so this picker starts empty and the mint button stays disabled
 *   until someone chooses. It is also the only thing that makes the acts-as
 *   column in the list worth having. (Found via a copy review: the admin-only
 *   note tells members to ask for "a key in your name", which was true of the
 *   API and unreachable from this dialog.)
 */
export function MintKeyDialog({
  open,
  onClose,
  onMinted,
  members,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired after the token has been acknowledged, so the list refreshes then. */
  onMinted: () => void;
  /** Candidate actors. Org-scoped already; db/0009's composite FK is the wall. */
  members: User[];
  /** Only to decide second vs third person in the acts-as note. */
  meId: string;
}) {
  const t = useTranslations("gateway");
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [name, setName] = useState("");
  const [actorId, setActorId] = useState("");
  const [allowAssistant, setAllowAssistant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actor = members.find((m) => m.id === actorId);

  function reset() {
    setPhase({ step: "form" });
    setName("");
    setActorId("");
    setAllowAssistant(false);
    setError(null);
  }

  async function mint() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(t("nameRequired"));
      return;
    }
    if (actorId === "") {
      setError(t("actorRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createGatewayKey(trimmed, allowAssistant, actorId);
      setPhase({ step: "minted", token: created.token, name: created.name });
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      // Once a token is on screen, Escape and backdrop clicks stop being an
      // exit — they would destroy the only copy that will ever exist.
      dismissible={phase.step === "form"}
      onClose={() => {
        reset();
        onClose();
      }}
      title={phase.step === "form" ? t("mintTitle") : t("keyOnceTitle")}
    >
      {phase.step === "minted" ? (
        <SecretOnce
          body={t("keyOnceBody")}
          value={phase.token}
          ackLabel={t("keySaved")}
          onDone={() => {
            reset();
            onMinted();
            onClose();
          }}
        />
      ) : (
        <div className="space-y-4">
          <Field label={t("nameLabel")} hint={t("nameHint")}>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </Field>

          <Field label={t("actsAsLabel")} hint={t("actsAsSelectHint")}>
            {/*
              Starts unchosen. There is no "(me)" default on purpose — see the
              header comment; a defaulted actor is a defaulted power.

              Non-active members stay VISIBLE but unselectable, labelled with
              why. Hiding them would answer "why can't I pick Reza?" with
              silence; showing them disabled answers it with the fact. A key
              acting as a disabled member resolves to nothing at
              `echo.resolve_api_key`, so it would be born dead.
            */}
            <Select
              value={actorId}
              placeholder={t("actorChoose")}
              onChange={setActorId}
              options={[
                { value: "", label: t("actorChoose") },
                ...members.map((member) => ({
                  value: member.id,
                  label: member.status === "active"
                    ? member.display_name
                    : `${member.display_name} — ${t(`memberStatus_${member.status}`)}`,
                  disabled: member.status !== "active",
                })),
              ]}
            />
          </Field>

          {actor ? (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <p className="text-sm font-medium text-fg">{t("actsAs", { name: actor.display_name })}</p>
              {/*
                Second person when the admin picks themselves. The third-person
                form is true either way, but "this key can do what سارا محمدی
                can do" read at سارا محمدی is a sentence about a stranger who
                happens to share your name. The canon's force is "bounded by a
                specific person's authority" and that survives both forms; only
                the pronoun changes.
              */}
              <p className="mt-1 text-xs leading-6 text-fg-muted">
                {actor.id === meId
                  ? t("actsAsSelfNote")
                  : t("actsAsPersonNote", { name: actor.display_name })}
              </p>
            </div>
          ) : null}

          <div className="rounded-md border border-border p-3">
            <label className="tap flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                checked={allowAssistant}
                onChange={(event) => setAllowAssistant(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-fg">{t("allowAssistant")}</span>
                <span className="mt-1 block text-xs leading-6 text-fg-muted">
                  {t("allowAssistantHint")}
                </span>
              </span>
            </label>
            <p className="mt-2 border-t border-border pt-2 text-xs leading-6 text-fg-muted">
              {t("capabilitiesImmutable")}
            </p>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              // Disabled until the actor is chosen: the choice cannot be
              // skipped past, which is the whole point of making it required.
              disabled={busy || actorId === "" || name.trim() === ""}
              onClick={() => void mint()}
            >
              {busy ? t("minting") : t("mint")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
