/**
 * The WATCHTOWER (item 10 of the 2026-08-23 pass): production errors reach
 * an error tracker instead of waiting in journalctl for someone to look.
 *
 * A zero-dependency Sentry-protocol reporter, ON PURPOSE. The recorded
 * verdict (release-chores, 2026-08-23) was "adopt with strict scrubbing:
 * no request bodies, no default PII, beforeSend mirroring the pino
 * codes-only redaction". A full SDK ships breadcrumbs, request capture
 * and local-variable collection that all have to be TURNED OFF and STAY
 * off — every upgrade a chance for content to leak back in. Here the
 * payload is CONSTRUCTED, not filtered: the only bytes that can travel
 * are the ones `buildEvent` writes, and its test proves what those are.
 *
 * Invariant 7 (content never in logs) applied to a third party:
 *  - error MESSAGES never travel for database errors — codes, constraint,
 *    table, column only (the pg `detail` quotes the offending ROW);
 *  - other messages travel truncated with every quoted string REMOVED —
 *    a transcript fragment embedded in an unexpected error's message is
 *    exactly the leak this exists to prevent;
 *  - stack FRAMES travel (paths and line numbers are ours, not content);
 *  - no request bodies, no headers, no user identifiers beyond the uuid.
 *
 * Disabled entirely without SENTRY_DSN — a missing tower is a visible
 * config state, never an error. Works against GlitchTip or Sentry (same
 * DSN/envelope protocol).
 */

export interface WatchtowerEvent {
  exception: { values: { type: string; value: string; stacktrace?: { frames: { filename: string; lineno?: number; function?: string }[] } }[] };
  level: "error";
  platform: "node";
  timestamp: number;
  tags: Record<string, string>;
  server_name?: string;
}

interface Dsn {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
}

function parseDsn(raw: string): Dsn | null {
  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return { publicKey: url.username, host: url.host, projectId, protocol: url.protocol.replace(":", "") };
  } catch {
    return null;
  }
}

/** Strip every quoted span — a message that embeds content does it in quotes. */
export function scrubMessage(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/«[^»]*»/g, "«…»")
    .split("\n")[0]!
    .slice(0, 300);
}

const PG_FIELDS = ["code", "constraint_name", "constraint", "table_name", "table", "column_name", "column", "routine"] as const;

/**
 * The whole event, as a pure function — its test is the scrubbing contract.
 * `pgLike` errors (anything carrying a SQLSTATE `code`) contribute NO
 * message at all: identifiers say which rule broke and cannot quote a row.
 */
export function buildEvent(
  error: unknown,
  tags: Record<string, string>,
): WatchtowerEvent {
  const err = error instanceof Error ? error : new Error(String(typeof error));
  const pg = error as Record<string, unknown>;
  const isPg = typeof pg?.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code as string);

  const pgTags: Record<string, string> = {};
  if (isPg) {
    for (const field of PG_FIELDS) {
      const value = pg[field];
      if (typeof value === "string" && value) pgTags[`pg.${field}`] = value.slice(0, 100);
    }
  }

  const frames = (err.stack ?? "")
    .split("\n")
    .slice(1, 21)
    .map((line) => {
      const m = line.match(/at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/);
      return m ? { function: m[1] ?? "?", filename: m[2]!, lineno: Number(m[3]) } : null;
    })
    .filter((f): f is { function: string; filename: string; lineno: number } => f !== null)
    .reverse();

  return {
    exception: {
      values: [{
        type: err.constructor.name,
        // a database error's message can quote the offending row — for
        // those, the identifiers above are the WHOLE story
        value: isPg ? `sqlstate ${String(pg.code)}` : scrubMessage(err.message),
        ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
      }],
    },
    level: "error",
    platform: "node",
    timestamp: Date.now() / 1000,
    tags: { ...tags, ...pgTags },
  };
}

let dsn: Dsn | null = null;
let service = "core";

/** Reads SENTRY_DSN; absent = the tower stays dark, loudly once. */
export function initWatchtower(serviceName: string, log?: { info: (o: object, m: string) => void }): boolean {
  service = serviceName;
  const raw = process.env.SENTRY_DSN;
  dsn = raw ? parseDsn(raw) : null;
  log?.info({ watchtower: dsn ? "on" : "off" }, dsn
    ? "watchtower reporting enabled"
    : "SENTRY_DSN not set — errors stay in journal only");
  return dsn !== null;
}

/** Fire-and-forget; a failed report must never become a second error. */
export function reportError(error: unknown, tags: Record<string, string> = {}): void {
  if (!dsn) return;
  try {
    const event = buildEvent(error, { service, ...tags });
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({ event_id: eventId, ...event }),
      "",
    ].join("\n");
    const url = `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    void fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=neurai-watchtower/1`,
      },
      body: envelope,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  } catch {
    /* never a second error */
  }
}
