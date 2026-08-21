"use client";

import { useState } from "react";
import { PRESENCE_ORB_OPTIONS, PresenceOrbPreview, type PresenceOrbVariant } from "@/components/platform/PresenceOrbPreview";

export default function PresencePreviewPage() {
  const [level, setLevel] = useState(0.8);
  const [selected, setSelected] = useState<PresenceOrbVariant>("flow");

  return (
    <main className="min-h-dvh bg-bg px-5 py-10 text-fg sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-fg-muted">NeurAI Platform · assistant presence preview</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Choose the assistant’s living presence</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">
          These are the real WebGL renderers. Raise voice energy to drive their GPU shaders exactly as the site can.
        </p>
        <label className="mt-7 flex max-w-md items-center gap-3 text-sm font-medium">
          Voice energy
          <input
            aria-label="Voice energy"
            className="h-2 flex-1 accent-accent"
            type="range"
            min="0"
            max="100"
            value={Math.round(level * 100)}
            onChange={(event) => setLevel(Number(event.target.value) / 100)}
          />
          <output className="w-10 text-end tabular-nums text-fg-muted">{Math.round(level * 100)}%</output>
        </label>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Assistant presence choices">
          {PRESENCE_ORB_OPTIONS.map((option) => {
            const active = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(option.id)}
                className={`tap rounded-2xl border p-3 text-start transition-colors ${
                  active ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-2"
                }`}
              >
                <PresenceOrbPreview variant={option.id} level={level} />
                <span className="mt-3 block text-sm font-semibold">{option.name}</span>
                <span className="mt-1 block text-xs text-fg-muted">{option.detail}</span>
              </button>
            );
          })}
        </section>
      </div>
    </main>
  );
}
