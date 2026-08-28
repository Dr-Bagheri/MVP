/**
 * Google/Microsoft OAuth connections (M30 / D29).
 *
 * The browser receives connection state and provider item metadata only. OAuth
 * tokens are encrypted before the database write, decrypted only on the
 * caller-bound server path, and are never handed to an agent/tool or logged.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { NotFoundError, ValidationError } from "./errors.ts";

export type ConnectorProvider = "google" | "microsoft";
export type ConnectorSourceKind = "calendar_event" | "mail_message";

interface ProviderCredentials {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

export interface ConnectorOAuthOptions {
  /** Public web origin, e.g. https://app.example.com. No callback accepts an arbitrary URL. */
  publicWebUrl?: string | undefined;
  /** base64-encoded 32-byte AES-256-GCM key, held only by the API process. */
  encryptionKey?: string | undefined;
  providers?: Partial<Record<ConnectorProvider, ProviderCredentials>> | undefined;
}

export interface ConnectorStatus {
  provider: ConnectorProvider;
  configured: boolean;
  status: "not_configured" | "not_connected" | "connected" | "expired" | "revoked";
  account_label: string | null;
  expires_at: string | null;
}

export interface ConnectorItem {
  id: string;
  title: string;
  subtitle: string;
  occurred_at: string | null;
}

export interface ConnectorContext {
  provider: ConnectorProvider;
  source_kind: ConnectorSourceKind;
  source_id: string;
  /** Stored as agent-run provenance but never logged. Treat as untrusted data. */
  content: string;
  label: string;
}

interface ConnectionRow {
  id: string;
  provider: ConnectorProvider;
  status: "connected" | "expired" | "revoked";
  account_label: string;
  expires_at: string | null;
  scopes: unknown;
}

interface SecretRow {
  encrypted_payload: Buffer | Uint8Array | string;
}

interface TokenPayload {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
}

interface ProviderTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

const PROVIDERS: readonly ConnectorProvider[] = ["google", "microsoft"];
const GOOGLE_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;
const MICROSOFT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.Read", "Mail.Read"] as const;
const CONTEXT_LIMIT = 16_000;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function providerScopes(provider: ConnectorProvider): readonly string[] {
  return provider === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES;
}

function normalOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function encryptionKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  try {
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? key : undefined;
  } catch {
    return undefined;
  }
}

function configured(options: ConnectorOAuthOptions, provider: ConnectorProvider): boolean {
  const credentials = options.providers?.[provider];
  return Boolean(normalOrigin(options.publicWebUrl) && encryptionKey(options.encryptionKey)
    && credentials?.clientId && credentials.clientSecret);
}

function requireConfigured(options: ConnectorOAuthOptions, provider: ConnectorProvider): {
  clientId: string; clientSecret: string; origin: string; key: Buffer;
} {
  const credentials = options.providers?.[provider];
  const origin = normalOrigin(options.publicWebUrl);
  const key = encryptionKey(options.encryptionKey);
  if (!origin || !key || !credentials?.clientId || !credentials.clientSecret) {
    throw new ValidationError("this connector is not configured on the server", { code: "connector_not_configured" });
  }
  return { clientId: credentials.clientId, clientSecret: credentials.clientSecret, origin, key };
}

function callbackUrl(origin: string, provider: ConnectorProvider): string {
  return `${origin}/api/connectors/${provider}/callback`;
}

function expectedRedirect(options: ConnectorOAuthOptions, provider: ConnectorProvider, redirectUri: string): {
  clientId: string; clientSecret: string; origin: string; key: Buffer;
} {
  const config = requireConfigured(options, provider);
  if (redirectUri !== callbackUrl(config.origin, provider)) {
    throw new ValidationError("invalid connector callback URL", { code: "connector_redirect_invalid" });
  }
  return config;
}

function encrypt(key: Buffer, payload: TokenPayload): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(key: Buffer, value: Buffer | Uint8Array | string): TokenPayload {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  if (bytes.length < 29) throw new Error("invalid connector credential payload");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const ciphertext = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as Record<string, unknown>;
  if (typeof parsed.accessToken !== "string") throw new Error("invalid connector credential fields");
  return {
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
    scopes: strings(parsed.scopes),
  };
}

function expireAt(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;
}

function tokenPayload(response: ProviderTokenResponse, previous?: TokenPayload): TokenPayload {
  if (typeof response.access_token !== "string" || response.access_token === "") {
    throw new Error("connector token response did not contain access_token");
  }
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : previous?.refreshToken ?? null,
    expiresAt: expireAt(response.expires_in),
    scopes: typeof response.scope === "string" ? response.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [],
  };
}

async function providerFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`connector provider request failed (${response.status})`);
  return await response.json() as Record<string, unknown>;
}

async function exchangeCode(
  provider: ConnectorProvider, config: { clientId: string; clientSecret: string },
  code: string, codeVerifier: string, redirectUri: string,
): Promise<TokenPayload> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    ...(provider === "microsoft" ? { scope: providerScopes(provider).join(" ") } : {}),
  });
  const endpoint = provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new ValidationError("the provider did not accept this connection", { code: "connector_authorization_failed" });
  return tokenPayload(await response.json() as ProviderTokenResponse);
}

async function refreshToken(
  provider: ConnectorProvider, config: { clientId: string; clientSecret: string }, previous: TokenPayload,
): Promise<TokenPayload> {
  if (!previous.refreshToken) throw new ValidationError("this connector needs to be reconnected", { code: "connector_reconnect_required" });
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: previous.refreshToken,
    grant_type: "refresh_token",
    ...(provider === "microsoft" ? { scope: providerScopes(provider).join(" ") } : {}),
  });
  const endpoint = provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  if (!response.ok) throw new ValidationError("this connector needs to be reconnected", { code: "connector_reconnect_required" });
  return tokenPayload(await response.json() as ProviderTokenResponse, previous);
}

function base64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function googleBody(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const payload = value as { mimeType?: unknown; body?: { data?: unknown }; parts?: unknown };
  if (payload.mimeType === "text/plain" && typeof payload.body?.data === "string") return base64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const decoded = googleBody(part);
      if (decoded) return decoded;
    }
  }
  return "";
}

function headers(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (item && typeof item === "object") {
      const name = text((item as Record<string, unknown>).name).toLowerCase();
      const val = text((item as Record<string, unknown>).value);
      if (name && val) result[name] = val;
    }
  }
  return result;
}

function limited(content: string): string {
  return content.length <= CONTEXT_LIMIT ? content : `${content.slice(0, CONTEXT_LIMIT)}\n…[truncated]`;
}

export function createConnectorsRepo(db: Db, options: ConnectorOAuthOptions = {}) {
  async function rows(identity: Identity): Promise<ConnectionRow[]> {
    return db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<ConnectionRow>(
      `select id, provider, status, account_label, expires_at, scopes
         from echo.connector_connection
        order by provider`,
    ));
  }

  async function connection(identity: Identity, provider: ConnectorProvider): Promise<ConnectionRow> {
    const found = (await rows(identity)).find((row) => row.provider === provider);
    if (!found || found.status !== "connected") throw new NotFoundError();
    return found;
  }

  async function token(identity: Identity, provider: ConnectorProvider): Promise<{ connection: ConnectionRow; token: TokenPayload }> {
    const conn = await connection(identity, provider);
    const config = requireConfigured(options, provider);
    const secret = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<SecretRow>(
      `select encrypted_payload from echo.connector_secret where connection_id = $1 limit 1`, [conn.id],
    ));
    if (!secret[0]) throw new NotFoundError();
    let current = decrypt(config.key, secret[0].encrypted_payload);
    const expiry = current.expiresAt ? Date.parse(current.expiresAt) : NaN;
    if (Number.isFinite(expiry) && expiry < Date.now() + 60_000) {
      try {
        current = await refreshToken(provider, config, current);
        await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
          `update echo.connector_secret set encrypted_payload = $2 where connection_id = $1`,
          [conn.id, encrypt(config.key, current)],
        ));
        await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
          `update echo.connector_connection set expires_at = $2, status = 'connected', revoked_at = null where id = $1`,
          [conn.id, current.expiresAt],
        ));
      } catch (error) {
        await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
          `update echo.connector_connection set status = 'expired' where id = $1`, [conn.id],
        ));
        throw error;
      }
    }
    return { connection: conn, token: current };
  }

  async function access(identity: Identity, provider: ConnectorProvider): Promise<string> {
    const current = await token(identity, provider);
    return current.token.accessToken;
  }

  async function accountLabel(provider: ConnectorProvider, accessToken: string): Promise<string> {
    try {
      if (provider === "google") {
        const profile = await providerFetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        return text(profile.email) || text(profile.name) || "Google account";
      }
      const profile = await providerFetch("https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return text(profile.userPrincipalName) || text(profile.displayName) || "Microsoft account";
    } catch {
      // A successful token exchange remains a connection even if the optional
      // label lookup is unavailable. The UI says provider account, not a made-up name.
      return provider === "google" ? "Google account" : "Microsoft account";
    }
  }

  return {
    async list(identity: Identity): Promise<ConnectorStatus[]> {
      const current = await rows(identity);
      return PROVIDERS.map((provider) => {
        const row = current.find((entry) => entry.provider === provider);
        const isConfigured = configured(options, provider);
        return {
          provider,
          configured: isConfigured,
          status: !isConfigured ? "not_configured" : row?.status ?? "not_connected",
          account_label: row?.account_label || null,
          expires_at: row?.expires_at ?? null,
        };
      });
    },

    async authorization(
      identity: Identity, provider: ConnectorProvider, state: string, codeChallenge: string, redirectUri: string,
    ): Promise<{ authorization_url: string }> {
      if (!/^[A-Za-z0-9_-]{24,200}$/.test(state) || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
        throw new ValidationError("invalid OAuth state", { code: "connector_state_invalid" });
      }
      const config = expectedRedirect(options, provider, redirectUri);
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: providerScopes(provider).join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        ...(provider === "google" ? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } : {}),
      });
      const endpoint = provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
      // The identity check above is intentional even though it has no rows to
      // touch: issuing an OAuth URL is an action bound to an active member.
      void identity;
      return { authorization_url: `${endpoint}?${params}` };
    },

    async complete(
      identity: Identity, provider: ConnectorProvider, code: string, codeVerifier: string, redirectUri: string,
    ): Promise<ConnectorStatus> {
      if (!code || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
        throw new ValidationError("invalid OAuth callback", { code: "connector_callback_invalid" });
      }
      const config = expectedRedirect(options, provider, redirectUri);
      const payload = await exchangeCode(provider, config, code, codeVerifier, redirectUri);
      const label = await accountLabel(provider, payload.accessToken);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ id: string }>(
        `insert into echo.connector_connection
           (org_id, owner_id, provider, status, account_label, scopes, expires_at, revoked_at)
         values ($1, $2, $3, 'connected', $4, ${JSONB_PARAM(5)}, $6, null)
         on conflict (owner_id, org_id, provider) do update
           set status = 'connected', account_label = excluded.account_label,
               scopes = excluded.scopes, expires_at = excluded.expires_at,
               revoked_at = null
         returning id`,
        [identity.orgId, identity.userId, provider, label, toJsonb(payload.scopes), payload.expiresAt],
      ));
      const id = rows[0]?.id;
      if (!id) throw new Error("connector connection insert returned no row");
      await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
        `insert into echo.connector_secret (connection_id, org_id, owner_id, encrypted_payload)
         values ($1, $2, $3, $4)
         on conflict (connection_id) do update set encrypted_payload = excluded.encrypted_payload`,
        [id, identity.orgId, identity.userId, encrypt(config.key, payload)],
      ));
      return {
        provider, configured: true, status: "connected", account_label: label,
        expires_at: payload.expiresAt,
      };
    },

    async calendarEvents(identity: Identity, provider: ConnectorProvider): Promise<ConnectorItem[]> {
      const bearer = await access(identity, provider);
      if (provider === "google") {
        const now = new Date().toISOString();
        const data = await providerFetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
            timeMin: now, singleEvents: "true", orderBy: "startTime", maxResults: "20",
          })}`,
          { headers: { authorization: `Bearer ${bearer}` } },
        );
        return (Array.isArray(data.items) ? data.items : []).flatMap((item): ConnectorItem[] => {
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          const start = record.start as Record<string, unknown> | undefined;
          const occurred = text(start?.dateTime) || text(start?.date) || null;
          const title = text(record.summary) || "Untitled event";
          return typeof record.id === "string" ? [{ id: record.id, title, subtitle: text(record.location), occurred_at: occurred }] : [];
        });
      }
      const start = new Date().toISOString();
      const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const data = await providerFetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({
          startDateTime: start, endDateTime: end, "$top": "20", "$select": "id,subject,start,location",
        })}`,
        { headers: { authorization: `Bearer ${bearer}` } },
      );
      return (Array.isArray(data.value) ? data.value : []).flatMap((item): ConnectorItem[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const begin = record.start as Record<string, unknown> | undefined;
        const place = record.location as Record<string, unknown> | undefined;
        return typeof record.id === "string" ? [{
          id: record.id, title: text(record.subject) || "Untitled event",
          subtitle: text(place?.displayName), occurred_at: text(begin?.dateTime) || null,
        }] : [];
      });
    },

    async mailMessages(identity: Identity, provider: ConnectorProvider): Promise<ConnectorItem[]> {
      const bearer = await access(identity, provider);
      if (provider === "google") {
        /* 20, the same as the other three source lists (calendar both
           providers, Microsoft mail): one number for "the recent ones",
           not a different one per provider. The per-message metadata
           reads below are parallel, so the count costs latency once. */
        const list = await providerFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20", {
          headers: { authorization: `Bearer ${bearer}` },
        });
        const ids = (Array.isArray(list.messages) ? list.messages : [])
          .flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
            ? [text((item as Record<string, unknown>).id)] : []);
        const messages = await Promise.all(ids.map((id) => providerFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { authorization: `Bearer ${bearer}` } },
        )));
        return messages.map((message, index) => {
          const h = headers((message.payload as Record<string, unknown> | undefined)?.headers);
          return {
            id: ids[index]!, title: h.subject || "(no subject)", subtitle: h.from || text(message.snippet),
            occurred_at: h.date || null,
          };
        });
      }
      const data = await providerFetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20DESC",
        { headers: { authorization: `Bearer ${bearer}` } },
      );
      return (Array.isArray(data.value) ? data.value : []).flatMap((item): ConnectorItem[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const from = (record.from as Record<string, unknown> | undefined)?.emailAddress as Record<string, unknown> | undefined;
        return typeof record.id === "string" ? [{
          id: record.id, title: text(record.subject) || "(no subject)",
          subtitle: text(from?.address) || text(record.bodyPreview), occurred_at: text(record.receivedDateTime) || null,
        }] : [];
      });
    },

    async sourceContext(
      identity: Identity, provider: ConnectorProvider, sourceKind: ConnectorSourceKind, sourceId: string,
    ): Promise<ConnectorContext> {
      if (!sourceId || sourceId.length > 512) throw new ValidationError("invalid connector source", { code: "connector_source_invalid" });
      const bearer = await access(identity, provider);
      if (provider === "google") {
        if (sourceKind === "calendar_event") {
          const event = await providerFetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(sourceId)}`,
            { headers: { authorization: `Bearer ${bearer}` } },
          );
          const start = event.start as Record<string, unknown> | undefined;
          const finish = event.end as Record<string, unknown> | undefined;
          const attendees = Array.isArray(event.attendees) ? event.attendees
            .map((entry) => entry && typeof entry === "object" ? text((entry as Record<string, unknown>).email) : "")
            .filter(Boolean) : [];
          const label = text(event.summary) || "Calendar event";
          return {
            provider, source_kind: sourceKind, source_id: sourceId, label,
            content: limited(JSON.stringify({ title: label, start: start?.dateTime ?? start?.date, end: finish?.dateTime ?? finish?.date, location: event.location, attendees, description: event.description })),
          };
        }
        const message = await providerFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sourceId)}?format=full`,
          { headers: { authorization: `Bearer ${bearer}` } },
        );
        const h = headers((message.payload as Record<string, unknown> | undefined)?.headers);
        const label = h.subject || "Email message";
        return {
          provider, source_kind: sourceKind, source_id: sourceId, label,
          content: limited(JSON.stringify({ subject: label, from: h.from, to: h.to, date: h.date, body: googleBody(message.payload) || text(message.snippet) })),
        };
      }
      if (sourceKind === "calendar_event") {
        const event = await providerFetch(
          `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(sourceId)}?$select=subject,start,end,location,attendees,bodyPreview`,
          { headers: { authorization: `Bearer ${bearer}`, Prefer: 'outlook.body-content-type="text"' } },
        );
        const label = text(event.subject) || "Calendar event";
        return {
          provider, source_kind: sourceKind, source_id: sourceId, label,
          content: limited(JSON.stringify({ title: label, start: event.start, end: event.end, location: event.location, attendees: event.attendees, description: event.bodyPreview })),
        };
      }
      const message = await providerFetch(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(sourceId)}?$select=subject,from,toRecipients,receivedDateTime,body,bodyPreview`,
        { headers: { authorization: `Bearer ${bearer}`, Prefer: 'outlook.body-content-type="text"' } },
      );
      const label = text(message.subject) || "Email message";
      return {
        provider, source_kind: sourceKind, source_id: sourceId, label,
        content: limited(JSON.stringify({ subject: label, from: message.from, to: message.toRecipients, date: message.receivedDateTime, body: (message.body as Record<string, unknown> | undefined)?.content ?? message.bodyPreview })),
      };
    },
  };
}
