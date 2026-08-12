"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { ModelInfo, User } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, Field, PageHeader } from "@/components/ui";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tAssistant = useTranslations("assistant");
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<User | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.me().then(setMe);
    void api.models().then((all) => setModels(all.filter((m) => m.allowed && m.tool_capable)));
  }, []);

  if (!me) return <AppShell page={t("title")}>{null}</AppShell>;

  return (
    <AppShell page={t("title")}>
      <PageHeader title={t("title")} />

      <Card className="max-w-xl space-y-4">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-xl font-bold text-accent">
            {me.display_name.slice(0, 1)}
          </div>
          <button className="btn-secondary h-10 min-h-0 px-3 text-xs">{t("avatar")}</button>
        </div>

        <Field label={t("displayName")}>
          <input
            className="input"
            value={me.display_name}
            onChange={(e) => setMe({ ...me, display_name: e.target.value })}
          />
        </Field>

        <Field label={t("language")}>
          <select
            className="input"
            value={me.locale}
            onChange={(e) => {
              const locale = e.target.value as "fa" | "en";
              setMe({ ...me, locale });
              void api.updateProfile({ locale });
              router.replace(pathname, { locale });
            }}
          >
            <option value="fa">فارسی</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label={t("model")} hint={tAssistant("toolCapableOnly")}>
          <select
            className="input"
            value={me.model_id ?? ""}
            onChange={(e) => {
              setMe({ ...me, model_id: e.target.value });
              void api.updateProfile({ model_id: e.target.value });
            }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} {model.suggested ? "★" : ""}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            onClick={async () => {
              await api.updateProfile({ display_name: me.display_name });
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
          >
            {t("save")}
          </button>
          {saved ? <Chip tone="success">{t("saved")}</Chip> : null}
        </div>
      </Card>
    </AppShell>
  );
}
