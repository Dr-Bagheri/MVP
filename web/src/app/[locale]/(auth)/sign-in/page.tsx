"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Card, Field } from "@/components/ui";

export default function SignInPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-sm font-bold text-on-accent">
          E
        </span>
        <h1 className="text-xl font-bold text-fg">{t("signInTitle")}</h1>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          router.push("/calls");
        }}
      >
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
            autoComplete="current-password"
          />
        </Field>
        <button className="btn-primary w-full" disabled={busy || !username || !password}>
          {t("signIn")}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-fg-muted">{t("orDivider")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* one-click Google sign-in (M15) */}
      <button className="btn-secondary w-full" onClick={() => router.push("/calls")}>
        <span className="ltr font-medium">G</span>
        {t("google")}
      </button>

      <p className="mt-4 text-center text-sm">
        <Link href="/sign-up" className="text-accent hover:underline">
          {t("noAccount")}
        </Link>
      </p>
    </Card>
  );
}
