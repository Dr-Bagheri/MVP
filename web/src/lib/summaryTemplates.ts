"use client";

/**
 * Custom summary templates (user directive, 2026-08-25): the «+» card on the
 * record page's regenerate section, also offered on the new-meeting form.
 *
 * INTERIM STORE — localStorage, marked as such (the client-search precedent):
 * a custom template is an authored convenience that steers generation, not a
 * record; losing it loses nothing the product promised to keep. The named
 * upgrade path is the skills ladder (batch-3 #1's ruling: summary templates
 * ARE skill-shaped), at which point this file's store swaps for the wire and
 * the shape below stays.
 */

export interface CustomTemplate {
  /** the display name — it becomes the VERSION's stored label (0094) */
  name: string;
  /** the prompt sent as the regenerate/new-meeting `instruction` */
  prompt: string;
}

const KEY = "neurai-summary-templates";
const MAX = 12;

export function customTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is CustomTemplate =>
        typeof (t as CustomTemplate).name === "string"
        && typeof (t as CustomTemplate).prompt === "string")
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveCustomTemplate(next: CustomTemplate): CustomTemplate[] {
  const name = next.name.trim().slice(0, 60);
  const prompt = next.prompt.trim().slice(0, 500);
  if (!name || !prompt) return customTemplates();
  const rest = customTemplates().filter((t) => t.name !== name);
  const all = [...rest, { name, prompt }].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fine */ }
  return all;
}

export function deleteCustomTemplate(name: string): CustomTemplate[] {
  const all = customTemplates().filter((t) => t.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fine */ }
  return all;
}
