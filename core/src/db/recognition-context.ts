/**
 * RECOGNITION CONTEXT (2026-09-06; user directive: "feed speaker names and
 * your project glossary as recognition context, which sharpens names and
 * jargon") — what the transcriber is told about the organisation BEFORE it
 * hears a word.
 *
 * Persian proper names are where a transcriber's errors concentrate, and
 * every name this product knows is already in the database: the org's own
 * glossary (0088), the people in the directory, the members, the projects.
 * The 2026-08-23 pass sent the glossary alone as a comma-joined string; this
 * builds the provider's STRUCTURED context — `terms` to recognise verbatim, a
 * `text` sentence about the recording (its title), `general` facts about the
 * organisation — once, for both lanes: the async pipeline (steps.ts) and the
 * live relay (the /v1/live-stt/start route).
 *
 * Two rules keep it honest. It is read under the CALLER's identity like every
 * other read — the worker as the call's owner, the route as the person — so
 * the context can only ever name what that person can already see (M3). And
 * it is BEST-EFFORT end to end: a failed read costs the bias, never the
 * transcription; the callers catch and log, this module never throws past a
 * missing column.
 */
import type { SqlTx } from "./identity.ts";

export interface RecognitionContext {
  terms: string[];
  text?: string;
  general?: { key: string; value: string }[];
}

/** the caps the producer applies; the lane applies the provider's again */
export const MAX_TERMS = 500;
export const MAX_TERMS_CHARS = 6_000;
const MAX_TEXT_CHARS = 300;

export interface ContextSources {
  /** the org's own list first — it was written to steer exactly this */
  glossary: readonly string[];
  /** echo.person display names — the speakers a transcript gets linked to */
  people: readonly string[];
  /** the members' names and handles */
  members: readonly string[];
  /** echo.project names — the jargon of the work itself */
  projects: readonly string[];
  /** the recording's title, when the call has one */
  title?: string | null;
  /** the organisation's name */
  org?: string | null;
}

/**
 * The pure half: normalise, de-duplicate (case-insensitively, ZWNJ folded so
 * «می‌شود» and «میشود» are one term), keep the producer's order — glossary,
 * people, members, projects — and stop at the budget. Returns null when there
 * is nothing to say, so the caller sends no `context` field at all: an empty
 * context is a claim we did not make.
 */
export function buildRecognitionContext(sources: ContextSources): RecognitionContext | null {
  const seen = new Set<string>();
  const terms: string[] = [];
  let chars = 0;
  const take = (raw: string | null | undefined): void => {
    const term = (raw ?? "").replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > 80) return;
    const key = term.toLocaleLowerCase().replace(/‌/g, "");
    if (seen.has(key)) return;
    if (terms.length >= MAX_TERMS || chars + term.length > MAX_TERMS_CHARS) return;
    seen.add(key);
    terms.push(term);
    chars += term.length;
  };
  for (const list of [sources.glossary, sources.people, sources.members, sources.projects]) {
    for (const item of list) take(item);
  }

  const text = (sources.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
  const org = (sources.org ?? "").trim();
  const general = org !== "" ? [{ key: "organization", value: org.slice(0, 200) }] : [];

  if (terms.length === 0 && text === "" && general.length === 0) return null;
  return {
    terms,
    ...(text !== "" ? { text } : {}),
    ...(general.length > 0 ? { general } : {}),
  };
}

/**
 * The reading half, inside the caller's transaction. Every query is bounded
 * and every list is what RLS lets this identity see; the glossary column is
 * read only where the caller says it exists (the 0088 capability), because a
 * missing column is a 42703 and this module promises never to throw one.
 */
export async function readRecognitionContext(
  tx: SqlTx,
  orgId: string,
  callId: string | null,
  options: { glossary: boolean },
): Promise<RecognitionContext | null> {
  const orgRows = await tx.unsafe<{ name: string | null; glossary: string[] | null }>(
    options.glossary
      ? `select o.name, o.glossary from echo.org o where o.id = $1`
      : `select o.name, null::text[] as glossary from echo.org o where o.id = $1`,
    [orgId],
  );
  const people = await tx.unsafe<{ display_name: string }>(
    `select p.display_name from echo.person p
      where p.org_id = $1 and p.display_name is not null
      order by p.display_name limit 400`,
    [orgId],
  );
  const members = await tx.unsafe<{ display_name: string | null; display_name_en: string | null; username: string | null }>(
    `select u.display_name, u.display_name_en, u.username from echo.app_user u
      where u.org_id = $1 and u.status = 'active'
      order by u.display_name limit 200`,
    [orgId],
  );
  const projects = await tx.unsafe<{ name: string }>(
    `select pr.name from echo.project pr where pr.org_id = $1 order by pr.name limit 200`,
    [orgId],
  );
  const title = callId
    ? (await tx.unsafe<{ title: string | null }>(`select c.title from echo.call c where c.id = $1`, [callId]))[0]?.title ?? null
    : null;

  return buildRecognitionContext({
    glossary: orgRows[0]?.glossary ?? [],
    people: people.map((row) => row.display_name),
    members: members.flatMap((row) => [row.display_name, row.display_name_en, row.username].filter((v): v is string => typeof v === "string")),
    projects: projects.map((row) => row.name),
    title,
    org: orgRows[0]?.name ?? null,
  });
}
