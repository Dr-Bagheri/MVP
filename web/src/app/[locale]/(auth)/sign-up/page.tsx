"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Card, Field } from "@/components/ui";

/** Self-registration exists, but the account lands pending (M15). */
export default function SignUpPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Card>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-sm font-bold text-white">
          E
        </span>
        <h1 className="text-xl font-bold text-fg">{t("signUpTitle")}</h1>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/pending");
        }}
      >
        <Field label={t("displayName")}>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field label={t("username")}>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </Field>
        <Field label={t("password")}>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <button className="btn-primary w-full" disabled={!username || !password || !displayName}>
          {t("signUp")}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-fg-muted">{t("orDivider")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <button className="btn-secondary w-full" onClick={() => router.push("/pending")}>
        <span className="ltr font-medium">G</span>
        {t("google")}
      </button>

      <p className="mt-4 text-center text-sm">
        <Link href="/sign-in" className="text-accent hover:underline">
          {t("haveAccount")}
        </Link>
      </p>
    </Card>
  );
}
