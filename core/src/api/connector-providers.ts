/**
 * THE CONNECTOR REGISTRY (2026-09-06, user directive: "connectors like in
 * Claude … Zoom, Slack, Telegram, Jira, Notion, GitHub, WhatsApp Business,
 * Dropbox/OneDrive, and a generic MCP connector … the same way, button and
 * style as the connectors we already have").
 *
 * One definition per provider, and connectors.ts speaks to a provider only
 * through it: how a grant is made (`oauth` or a pasted `token`), how the
 * account is named, which SOURCES it can list, which ACTIONS it can perform.
 * Google and Microsoft predate this file and keep their own paths in
 * connectors.ts (mail drafting, calendar polling and the workflow envelopes
 * lean on their exact shapes); everything that arrived with this file goes
 * through here, so the next provider is one entry and no new route.
 *
 * Three rules every entry obeys, because they are the wall rather than a
 * style:
 *
 *  · the grant is the PERSON's — a token pasted here is theirs, stored
 *    encrypted under their own connection row (D29); nothing here holds an
 *    organisation-wide credential an agent could reach past the person;
 *  · a read returns METADATA shaped as `ConnectorItem` (title, subtitle,
 *    when) — never a body a model could mistake for instructions; a body is
 *    fetched by the one caller that fences it;
 *  · an action is reached only from the route a consent card guards; the
 *    registry performs, it never decides.
 *
 * The provider calls are written against each provider's published API and
 * verified at acceptance with a real grant (rule 7's prove-at-acceptance);
 * the SHAPE decisions — which fields become a title, how a refusal is named —
 * are pure functions tested in connector-providers.test.ts.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ValidationError } from "./errors.ts";
import { CONNECTOR_PROVIDERS, type ConnectorProvider } from "./vocabulary.ts";

export { CONNECTOR_PROVIDERS, type ConnectorProvider } from "./vocabulary.ts";

export function isConnectorProvider(value: unknown): value is ConnectorProvider {
  return typeof value === "string" && (CONNECTOR_PROVIDERS as readonly string[]).includes(value);
}

export interface ConnectorItem {
  id: string;
  title: string;
  subtitle: string;
  occurred_at: string | null;
}

/** What a token-kind provider asks the person to paste. */
export type TokenField = "secret" | "url" | "phone_number_id" | "waba_id";

export interface OAuthSpec {
  authorizeUrl: string;
  tokenUrl: string;
  /** scopes on the authorize URL; empty = the app's own configuration decides */
  scopes: readonly string[];
  /** extra authorize-URL parameters (Slack's user_scope, Atlassian's audience) */
  extraAuthorize?: Record<string, string>;
  /** the provider honours PKCE — the verifier is sent on exchange only then */
  pkce: boolean;
  /** how the client secret travels to the token endpoint */
  tokenAuth: "basic" | "body";
  tokenBody: "form" | "json";
  /** Microsoft wants the scope list repeated on the token and refresh calls */
  scopeInTokenBody?: boolean;
  /** an access token that expires and can be renewed (refresh_token) */
  refreshable: boolean;
  /** the token endpoint speaks JSON only when asked (GitHub) */
  tokenAccept?: string;
  /**
   * where the access token sits in the token response when it is not the
   * OAuth default — Slack returns the USER token under `authed_user`
   */
  pickToken?: (json: Record<string, unknown>) => Record<string, unknown>;
}

export interface TokenSpec {
  fields: readonly TokenField[];
  required: readonly TokenField[];
}

/** what a provider call has in hand: the person's credential and their connection's public settings */
export interface ProviderCtx {
  bearer: string;
  settings: Record<string, unknown>;
}

export interface ProviderDef {
  provider: ConnectorProvider;
  /** the brand, for an account label when the provider gives none */
  brand: string;
  kind: "oauth" | "token";
  oauth?: OAuthSpec;
  token?: TokenSpec;
  sources: readonly string[];
  actions: readonly string[];
  /** the account's own name at the provider (email, handle, workspace) */
  accountLabel(ctx: ProviderCtx): Promise<string>;
  /** token kinds: prove the pasted credential works and learn the settings it implies */
  verify?(input: Record<string, string>): Promise<{ bearer: string; label: string; settings: Record<string, unknown> }>;
  /** after an OAuth exchange: settings the provider can only tell us with a token in hand (Jira's cloud id) */
  afterConnect?(ctx: ProviderCtx): Promise<Record<string, unknown>>;
  items(ctx: ProviderCtx, source: string): Promise<ConnectorItem[]>;
  act(ctx: ProviderCtx, action: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** tell the provider the grant is over, where an endpoint exists */
  revoke?(ctx: ProviderCtx, app: { clientId: string; clientSecret: string } | null): Promise<void>;
}

// ─── shared helpers ─────────────────────────────────────────────────────────

const LIST_LIMIT = 20;
const TEXT_LIMIT = 4_000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function required(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (!value) throw new ValidationError(`${key} is required`, { code: "connector_argument_missing", params: { field: key } });
  return value;
}

function clip(value: string, max = TEXT_LIMIT): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    /* unix seconds (Telegram, Slack's ts) → ISO; a ts like "1725600000.000100" arrives as a string */
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string" || value === "") return null;
  const numeric = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  const parsed = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The provider's refusal, named by its status class and nothing else (rule
 * 12): the body of a provider error can quote a person's message, so it never
 * reaches a log or a caller; the status is what tells a bad token from a rate
 * limit from an outage.
 */
export class ProviderRefusal extends Error {
  readonly errorType = "provider_refused";
  readonly providerStatus: number;
  /* an explicit field, not a parameter property: the production runtime runs
     `--experimental-strip-types`, which refuses parameter properties outright
     (rule 9's strip-types trap — the boot tests are what caught it) */
  constructor(providerStatus: number, what: string) {
    super(`connector provider request failed (${providerStatus}) at ${what}`);
    this.providerStatus = providerStatus;
  }
}

async function fetchJson(url: string, init: RequestInit & { what?: string } = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) throw new ProviderRefusal(response.status, init.what ?? new URL(url).hostname);
  if (response.status === 202 || response.status === 204) return {};
  const raw = await response.text();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  /* a bare array (GitHub's lists) rides under `items` so every reader sees an object */
  return Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>);
}

function bearerJson(ctx: ProviderCtx, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${ctx.bearer}`, "content-type": "application/json", accept: "application/json", ...extra };
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object")
    : [];
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * A URL a PERSON typed that this server will then connect to (the MCP
 * server) — the classic server-side request forgery shape. https only, a
 * public name, never a private or loopback address, checked on the literal
 * AND on what the name resolves to. A rebinding attack between this check
 * and the connect is out of scope here and said so.
 */
export async function assertPublicHttpsUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ValidationError("the server URL is not a valid URL", { code: "connector_url_invalid" });
  }
  if (url.protocol !== "https:") {
    throw new ValidationError("the server URL must use https", { code: "connector_url_invalid" });
  }
  if (url.username || url.password) {
    throw new ValidationError("the server URL must not carry credentials", { code: "connector_url_invalid" });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ValidationError("the server URL points inside the network", { code: "connector_url_private" });
  }
  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then((rows) => rows.map((row) => row.address)).catch(() => []);
  if (addresses.length === 0) {
    throw new ValidationError("the server URL does not resolve", { code: "connector_url_invalid" });
  }
  if (addresses.some(isPrivateAddress)) {
    throw new ValidationError("the server URL points inside the network", { code: "connector_url_private" });
  }
  return url;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const low = ip.toLowerCase();
  return low === "::1" || low === "::" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80") || low.startsWith("::ffff:");
}

// ─── Zoom ────────────────────────────────────────────────────────────────────

const ZOOM_API = "https://api.zoom.us/v2";

const zoom: ProviderDef = {
  provider: "zoom", brand: "Zoom", kind: "oauth",
  oauth: {
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    /* Zoom's scopes are declared on the app itself (granular scopes since
       2024); an explicit list here would have to match the app's or be
       refused, so the app is the one place they live */
    scopes: [],
    pkce: true, tokenAuth: "basic", tokenBody: "form", refreshable: true,
  },
  sources: ["meetings", "recordings"],
  actions: ["create_meeting"],
  async accountLabel(ctx) {
    const me = await fetchJson(`${ZOOM_API}/users/me`, { headers: bearerJson(ctx), what: "zoom me" });
    return text(me.email) || text(me.display_name) || "Zoom account";
  },
  async items(ctx, source) {
    if (source === "meetings") {
      const data = await fetchJson(`${ZOOM_API}/users/me/meetings?type=upcoming&page_size=${LIST_LIMIT}`, { headers: bearerJson(ctx), what: "zoom meetings" });
      return zoomMeetings(data);
    }
    if (source === "recordings") {
      const data = await fetchJson(`${ZOOM_API}/users/me/recordings?from=${daysAgo(30)}&page_size=${LIST_LIMIT}`, { headers: bearerJson(ctx), what: "zoom recordings" });
      return zoomRecordings(data);
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "create_meeting") throw unknownAction(action);
    const topic = required(args, "topic");
    const startsAt = str(args, "starts_at");
    const minutes = Number(args.minutes ?? 30);
    const created = await fetchJson(`${ZOOM_API}/users/me/meetings`, {
      method: "POST", headers: bearerJson(ctx), what: "zoom create meeting",
      body: JSON.stringify({
        topic, type: startsAt ? 2 : 1,
        ...(startsAt ? { start_time: new Date(startsAt).toISOString(), timezone: "UTC" } : {}),
        duration: Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.round(minutes), 24 * 60) : 30,
      }),
    });
    return { id: String(created.id ?? ""), join_url: text(created.join_url), start_url_present: typeof created.start_url === "string" };
  },
  async revoke(ctx, app) {
    if (!app) return;
    await fetch(`https://zoom.us/oauth/revoke?token=${encodeURIComponent(ctx.bearer)}`, {
      method: "POST", headers: { authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}` },
    });
  },
};

export function zoomMeetings(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.meetings).flatMap((meeting) => meeting.id === undefined ? [] : [{
    id: String(meeting.id),
    title: text(meeting.topic) || "Untitled meeting",
    subtitle: text(meeting.join_url),
    occurred_at: isoOrNull(meeting.start_time),
  }]).slice(0, LIST_LIMIT);
}

export function zoomRecordings(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.meetings).flatMap((meeting) => {
    const files = list(meeting.recording_files);
    const id = text(meeting.uuid) || String(meeting.id ?? "");
    return id ? [{
      id,
      title: text(meeting.topic) || "Untitled recording",
      subtitle: `${files.length} file${files.length === 1 ? "" : "s"}`,
      occurred_at: isoOrNull(meeting.start_time),
    }] : [];
  }).slice(0, LIST_LIMIT);
}

// ─── Slack ───────────────────────────────────────────────────────────────────

const SLACK_API = "https://slack.com/api";
const SLACK_USER_SCOPES = "channels:read,groups:read,channels:history,groups:history,search:read,chat:write,users:read";

/** Slack answers 200 with `ok: false` — the refusal is in the body, so the body is read */
async function slackCall(ctx: ProviderCtx, method: string, init: { params?: Record<string, string>; body?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
  const url = `${SLACK_API}/${method}${init.params ? `?${new URLSearchParams(init.params)}` : ""}`;
  const data = await fetchJson(url, {
    method: init.body ? "POST" : "GET", headers: bearerJson(ctx), what: `slack ${method}`,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (data.ok === false) throw new ProviderRefusal(text(data.error) === "invalid_auth" || text(data.error) === "token_revoked" ? 401 : 400, `slack ${method}`);
  return data;
}

const slack: ProviderDef = {
  provider: "slack", brand: "Slack", kind: "oauth",
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: [],
    /* USER scopes only: the connector acts as the person, not as a bot the
       whole workspace can see — the reach rule at the provider */
    extraAuthorize: { user_scope: SLACK_USER_SCOPES },
    pkce: false, tokenAuth: "body", tokenBody: "form", refreshable: false,
    pickToken: (json) => {
      const user = json.authed_user as Record<string, unknown> | undefined;
      return { access_token: user?.access_token, scope: user?.scope, expires_in: user?.expires_in, refresh_token: user?.refresh_token };
    },
  },
  sources: ["channels", "mentions"],
  actions: ["send_message"],
  async accountLabel(ctx) {
    const me = await slackCall(ctx, "auth.test");
    return [text(me.user), text(me.team)].filter(Boolean).join(" @ ") || "Slack account";
  },
  async afterConnect(ctx) {
    const me = await slackCall(ctx, "auth.test");
    return { user_id: text(me.user_id), team: text(me.team), team_id: text(me.team_id) };
  },
  async items(ctx, source) {
    if (source === "channels") {
      const data = await slackCall(ctx, "conversations.list", { params: { types: "public_channel,private_channel", exclude_archived: "true", limit: "50" } });
      return slackChannels(data);
    }
    if (source === "mentions") {
      const userId = text(ctx.settings.user_id) || text((await slackCall(ctx, "auth.test")).user_id);
      const data = await slackCall(ctx, "search.messages", { params: { query: `<@${userId}>`, count: String(LIST_LIMIT), sort: "timestamp", sort_dir: "desc" } });
      return slackMentions(data);
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "send_message") throw unknownAction(action);
    const channel = required(args, "channel");
    const body = required(args, "text");
    const target = /^[CDG][A-Z0-9]{6,}$/.test(channel) ? channel : await slackChannelId(ctx, channel.replace(/^#/, ""));
    const sent = await slackCall(ctx, "chat.postMessage", { body: { channel: target, text: clip(body) } });
    return { channel: text(sent.channel), ts: text(sent.ts) };
  },
  async revoke(ctx) {
    try { await slackCall(ctx, "auth.revoke"); } catch { /* local revocation stands */ }
  },
};

async function slackChannelId(ctx: ProviderCtx, name: string): Promise<string> {
  const data = await slackCall(ctx, "conversations.list", { params: { types: "public_channel,private_channel", exclude_archived: "true", limit: "200" } });
  const hit = list(data.channels).find((channel) => text(channel.name).toLowerCase() === name.toLowerCase());
  if (!hit) throw new ValidationError(`no Slack channel named #${name}`, { code: "connector_target_unknown", params: { target: name } });
  return text(hit.id);
}

export function slackChannels(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.channels).flatMap((channel) => channel.id === undefined ? [] : [{
    id: text(channel.id),
    title: `#${text(channel.name)}`,
    subtitle: text((channel.topic as Record<string, unknown> | undefined)?.value) || `${Number(channel.num_members ?? 0)} members`,
    occurred_at: null,
  }]).slice(0, LIST_LIMIT);
}

export function slackMentions(data: Record<string, unknown>): ConnectorItem[] {
  const messages = data.messages as Record<string, unknown> | undefined;
  return list(messages?.matches).flatMap((message) => {
    const ts = text(message.ts);
    return ts ? [{
      id: ts,
      title: clip(text(message.text), 120) || "(no text)",
      subtitle: `#${text((message.channel as Record<string, unknown> | undefined)?.name)} · ${text(message.username)}`,
      occurred_at: isoOrNull(ts),
    }] : [];
  }).slice(0, LIST_LIMIT);
}

// ─── Telegram ────────────────────────────────────────────────────────────────

const telegram: ProviderDef = {
  provider: "telegram", brand: "Telegram", kind: "token",
  token: { fields: ["secret"], required: ["secret"] },
  sources: ["updates"],
  actions: ["send_message"],
  async accountLabel(ctx) {
    return `@${text(ctx.settings.bot_username) || "bot"}`;
  },
  async verify(input) {
    const token = (input.secret ?? "").trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
      throw new ValidationError("that is not a Telegram bot token", { code: "connector_token_invalid" });
    }
    const me = await fetchJson(`https://api.telegram.org/bot${token}/getMe`, { what: "telegram getMe" });
    const result = me.result as Record<string, unknown> | undefined;
    if (me.ok !== true || !result) throw new ProviderRefusal(401, "telegram getMe");
    const username = text(result.username);
    return { bearer: token, label: `@${username || text(result.first_name) || "bot"}`, settings: { bot_username: username } };
  },
  async items(ctx, source) {
    if (source !== "updates") throw unknownSource(source);
    const data = await fetchJson(`https://api.telegram.org/bot${ctx.bearer}/getUpdates?limit=50&allowed_updates=%5B%22message%22%5D`, { what: "telegram getUpdates" });
    return telegramUpdates(data);
  },
  async act(ctx, action, args) {
    if (action !== "send_message") throw unknownAction(action);
    const chat = required(args, "chat");
    const body = required(args, "text");
    const sent = await fetchJson(`https://api.telegram.org/bot${ctx.bearer}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, what: "telegram sendMessage",
      body: JSON.stringify({ chat_id: /^-?\d+$/.test(chat) ? Number(chat) : chat.startsWith("@") ? chat : `@${chat}`, text: clip(body) }),
    });
    const result = sent.result as Record<string, unknown> | undefined;
    return { message_id: String(result?.message_id ?? ""), chat: text((result?.chat as Record<string, unknown> | undefined)?.title) };
  },
};

export function telegramUpdates(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.result).flatMap((update) => {
    const message = update.message as Record<string, unknown> | undefined;
    const chat = message?.chat as Record<string, unknown> | undefined;
    if (!message || !chat || chat.id === undefined) return [];
    const who = text(chat.title) || text(chat.username) || [text(chat.first_name), text(chat.last_name)].filter(Boolean).join(" ") || String(chat.id);
    return [{
      id: `${chat.id}:${message.message_id ?? ""}`,
      title: who,
      subtitle: clip(text(message.text) || text(message.caption), 120),
      occurred_at: isoOrNull(message.date),
    }];
  }).reverse().slice(0, LIST_LIMIT);
}

// ─── Jira (Atlassian cloud) ─────────────────────────────────────────────────

const ATLASSIAN_API = "https://api.atlassian.com";

function jiraBase(ctx: ProviderCtx): string {
  const cloudId = text(ctx.settings.cloud_id);
  if (!cloudId) throw new ValidationError("this Jira connection has no site — reconnect it", { code: "connector_reconnect_required" });
  return `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3`;
}

const jira: ProviderDef = {
  provider: "jira", brand: "Jira", kind: "oauth",
  oauth: {
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:jira-work", "write:jira-work", "read:jira-user", "read:me", "offline_access"],
    extraAuthorize: { audience: "api.atlassian.com", prompt: "consent" },
    pkce: false, tokenAuth: "body", tokenBody: "json", refreshable: true,
  },
  sources: ["issues", "projects"],
  actions: ["create_issue"],
  async accountLabel(ctx) {
    const me = await fetchJson(`${ATLASSIAN_API}/me`, { headers: bearerJson(ctx), what: "atlassian me" });
    return text(me.email) || text(me.name) || "Atlassian account";
  },
  async afterConnect(ctx) {
    const data = await fetchJson(`${ATLASSIAN_API}/oauth/token/accessible-resources`, { headers: bearerJson(ctx), what: "atlassian resources" });
    const site = list(data.items)[0];
    return site ? { cloud_id: text(site.id), site_name: text(site.name), site_url: text(site.url) } : {};
  },
  async items(ctx, source) {
    if (source === "issues") {
      const params = new URLSearchParams({ jql: "assignee = currentUser() ORDER BY updated DESC", maxResults: String(LIST_LIMIT), fields: "summary,status,updated,project" });
      const data = await fetchJson(`${jiraBase(ctx)}/search/jql?${params}`, { headers: bearerJson(ctx), what: "jira search" });
      return jiraIssues(data, text(ctx.settings.site_url));
    }
    if (source === "projects") {
      const data = await fetchJson(`${jiraBase(ctx)}/project/search?maxResults=50&orderBy=lastIssueUpdatedTime`, { headers: bearerJson(ctx), what: "jira projects" });
      return jiraProjects(data);
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "create_issue") throw unknownAction(action);
    const project = required(args, "project").toUpperCase();
    const summary = required(args, "summary");
    const description = str(args, "description");
    const created = await fetchJson(`${jiraBase(ctx)}/issue`, {
      method: "POST", headers: bearerJson(ctx), what: "jira create issue",
      body: JSON.stringify({
        fields: {
          project: { key: project }, summary: clip(summary, 250), issuetype: { name: "Task" },
          ...(description ? { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: clip(description) }] }] } } : {}),
        },
      }),
    });
    const key = text(created.key);
    return { key, url: key && text(ctx.settings.site_url) ? `${text(ctx.settings.site_url)}/browse/${key}` : "" };
  },
};

export function jiraIssues(data: Record<string, unknown>, siteUrl: string): ConnectorItem[] {
  return list(data.issues).flatMap((issue) => {
    const fields = issue.fields as Record<string, unknown> | undefined;
    const key = text(issue.key);
    if (!key) return [];
    const status = text((fields?.status as Record<string, unknown> | undefined)?.name);
    const project = text((fields?.project as Record<string, unknown> | undefined)?.name);
    return [{
      id: key,
      title: `${key} · ${text(fields?.summary) || "(no summary)"}`,
      subtitle: [status, project, siteUrl ? `${siteUrl}/browse/${key}` : ""].filter(Boolean).join(" · "),
      occurred_at: isoOrNull(fields?.updated),
    }];
  }).slice(0, LIST_LIMIT);
}

export function jiraProjects(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.values).flatMap((project) => text(project.key) ? [{
    id: text(project.key),
    title: `${text(project.key)} · ${text(project.name)}`,
    subtitle: text(project.projectTypeKey),
    occurred_at: null,
  }] : []).slice(0, 50);
}

// ─── Notion ─────────────────────────────────────────────────────────────────

const NOTION_API = "https://api.notion.com/v1";
const NOTION_HEADERS = { "Notion-Version": "2022-06-28" };

const notion: ProviderDef = {
  provider: "notion", brand: "Notion", kind: "oauth",
  oauth: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [], extraAuthorize: { owner: "user" },
    pkce: false, tokenAuth: "basic", tokenBody: "json", refreshable: false,
  },
  sources: ["pages", "databases"],
  actions: ["create_page"],
  async accountLabel(ctx) {
    const me = await fetchJson(`${NOTION_API}/users/me`, { headers: bearerJson(ctx, NOTION_HEADERS), what: "notion me" });
    const bot = me.bot as Record<string, unknown> | undefined;
    return text(bot?.workspace_name) || text(me.name) || "Notion workspace";
  },
  async items(ctx, source) {
    if (source !== "pages" && source !== "databases") throw unknownSource(source);
    const data = await fetchJson(`${NOTION_API}/search`, {
      method: "POST", headers: bearerJson(ctx, NOTION_HEADERS), what: "notion search",
      body: JSON.stringify({
        filter: { property: "object", value: source === "pages" ? "page" : "database" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: LIST_LIMIT,
      }),
    });
    return notionResults(data);
  },
  async act(ctx, action, args) {
    if (action !== "create_page") throw unknownAction(action);
    const title = required(args, "title");
    const parent = required(args, "parent");
    const content = str(args, "content");
    const parentId = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i.test(parent) ? parent : await notionPageIdByTitle(ctx, parent);
    const created = await fetchJson(`${NOTION_API}/pages`, {
      method: "POST", headers: bearerJson(ctx, NOTION_HEADERS), what: "notion create page",
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: { title: { title: [{ type: "text", text: { content: clip(title, 200) } }] } },
        ...(content ? { children: content.split(/\n{2,}/).slice(0, 50).map((paragraph) => ({
          object: "block", type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: clip(paragraph, 1_900) } }] },
        })) } : {}),
      }),
    });
    return { id: text(created.id), url: text(created.url) };
  },
};

async function notionPageIdByTitle(ctx: ProviderCtx, title: string): Promise<string> {
  const data = await fetchJson(`${NOTION_API}/search`, {
    method: "POST", headers: bearerJson(ctx, NOTION_HEADERS), what: "notion search",
    body: JSON.stringify({ query: title, filter: { property: "object", value: "page" }, page_size: 5 }),
  });
  const hit = notionResults(data).find((item) => item.title.toLowerCase() === title.toLowerCase()) ?? notionResults(data)[0];
  if (!hit) throw new ValidationError(`no Notion page named "${title}"`, { code: "connector_target_unknown", params: { target: title } });
  return hit.id;
}

/** a Notion object's title lives in whichever property is of type `title` — or, for a database, in `title[]` */
export function notionTitle(entry: Record<string, unknown>): string {
  const plain = (parts: unknown): string => list(parts).map((part) => text(part.plain_text)).join("").trim();
  if (Array.isArray(entry.title)) return plain(entry.title);
  const properties = entry.properties as Record<string, unknown> | undefined;
  for (const value of Object.values(properties ?? {})) {
    const property = value as Record<string, unknown>;
    if (property?.type === "title") return plain(property.title);
  }
  return "";
}

export function notionResults(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.results).flatMap((entry) => text(entry.id) ? [{
    id: text(entry.id),
    title: notionTitle(entry) || "Untitled",
    subtitle: text(entry.url),
    occurred_at: isoOrNull(entry.last_edited_time),
  }] : []).slice(0, LIST_LIMIT);
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = { accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "user-agent": "neurai-platform" };

const github: ProviderDef = {
  provider: "github", brand: "GitHub", kind: "oauth",
  oauth: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "user:email"],
    pkce: false, tokenAuth: "body", tokenBody: "form", refreshable: true, tokenAccept: "application/json",
  },
  sources: ["issues", "pulls", "repos"],
  actions: ["create_issue"],
  async accountLabel(ctx) {
    const me = await fetchJson(`${GITHUB_API}/user`, { headers: bearerJson(ctx, GITHUB_HEADERS), what: "github user" });
    return text(me.login) || "GitHub account";
  },
  async items(ctx, source) {
    if (source === "issues") {
      const data = await fetchJson(`${GITHUB_API}/issues?filter=assigned&state=open&per_page=${LIST_LIMIT}`, { headers: bearerJson(ctx, GITHUB_HEADERS), what: "github issues" });
      return githubIssues(data);
    }
    if (source === "pulls") {
      const data = await fetchJson(`${GITHUB_API}/search/issues?q=${encodeURIComponent("is:pr is:open involves:@me")}&per_page=${LIST_LIMIT}&sort=updated`, { headers: bearerJson(ctx, GITHUB_HEADERS), what: "github pulls" });
      return githubIssues(data);
    }
    if (source === "repos") {
      const data = await fetchJson(`${GITHUB_API}/user/repos?sort=updated&per_page=${LIST_LIMIT}`, { headers: bearerJson(ctx, GITHUB_HEADERS), what: "github repos" });
      return githubRepos(data);
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "create_issue") throw unknownAction(action);
    const repository = required(args, "repository");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      throw new ValidationError("repository must be owner/name", { code: "connector_argument_invalid", params: { field: "repository" } });
    }
    const title = required(args, "title");
    const body = str(args, "body");
    const created = await fetchJson(`${GITHUB_API}/repos/${repository}/issues`, {
      method: "POST", headers: bearerJson(ctx, GITHUB_HEADERS), what: "github create issue",
      body: JSON.stringify({ title: clip(title, 250), ...(body ? { body: clip(body, 60_000) } : {}) }),
    });
    return { number: Number(created.number ?? 0), url: text(created.html_url) };
  },
};

export function githubIssues(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.items).flatMap((issue) => issue.number === undefined ? [] : [{
    id: String(issue.number),
    title: `#${issue.number} · ${text(issue.title)}`,
    subtitle: [
      text((issue.repository as Record<string, unknown> | undefined)?.full_name) || text(issue.repository_url).replace(`${GITHUB_API}/repos/`, ""),
      issue.pull_request ? "pull request" : "issue",
      text(issue.html_url),
    ].filter(Boolean).join(" · "),
    occurred_at: isoOrNull(issue.updated_at),
  }]).slice(0, LIST_LIMIT);
}

export function githubRepos(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.items).flatMap((repo) => text(repo.full_name) ? [{
    id: text(repo.full_name),
    title: text(repo.full_name),
    subtitle: text(repo.description),
    occurred_at: isoOrNull(repo.updated_at),
  }] : []).slice(0, LIST_LIMIT);
}

// ─── WhatsApp Business (Meta Cloud API) ─────────────────────────────────────

const GRAPH_API = "https://graph.facebook.com/v21.0";

const whatsapp: ProviderDef = {
  provider: "whatsapp", brand: "WhatsApp Business", kind: "token",
  token: { fields: ["secret", "phone_number_id", "waba_id"], required: ["secret", "phone_number_id"] },
  sources: ["profile", "templates"],
  actions: ["send_message"],
  async accountLabel(ctx) {
    return text(ctx.settings.display_phone_number) || "WhatsApp number";
  },
  async verify(input) {
    const token = (input.secret ?? "").trim();
    const phoneId = (input.phone_number_id ?? "").trim();
    const wabaId = (input.waba_id ?? "").trim();
    if (!token || !/^\d{6,}$/.test(phoneId) || (wabaId && !/^\d{6,}$/.test(wabaId))) {
      throw new ValidationError("a permanent access token and a numeric phone number id are required", { code: "connector_token_invalid" });
    }
    const number = await fetchJson(`${GRAPH_API}/${phoneId}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { authorization: `Bearer ${token}` }, what: "whatsapp phone",
    });
    const display = text(number.display_phone_number);
    return {
      bearer: token,
      label: [text(number.verified_name), display].filter(Boolean).join(" · ") || "WhatsApp number",
      settings: { phone_number_id: phoneId, ...(wabaId ? { waba_id: wabaId } : {}), display_phone_number: display, verified_name: text(number.verified_name) },
    };
  },
  async items(ctx, source) {
    const phoneId = text(ctx.settings.phone_number_id);
    if (source === "profile") {
      const data = await fetchJson(`${GRAPH_API}/${phoneId}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical`, { headers: bearerJson(ctx), what: "whatsapp profile" });
      return whatsappProfile(data, phoneId);
    }
    if (source === "templates") {
      const wabaId = text(ctx.settings.waba_id);
      if (!wabaId) throw new ValidationError("templates need the WhatsApp Business Account id — reconnect with it", { code: "connector_setting_missing", params: { field: "waba_id" } });
      const data = await fetchJson(`${GRAPH_API}/${wabaId}/message_templates?fields=name,status,language,category&limit=50`, { headers: bearerJson(ctx), what: "whatsapp templates" });
      return whatsappTemplates(data);
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "send_message") throw unknownAction(action);
    const to = required(args, "to").replace(/[^\d]/g, "");
    if (to.length < 7) throw new ValidationError("`to` must be a phone number in international form", { code: "connector_argument_invalid", params: { field: "to" } });
    const template = str(args, "template");
    const body = str(args, "text");
    if (!template && !body) throw new ValidationError("text or template is required", { code: "connector_argument_missing", params: { field: "text" } });
    const sent = await fetchJson(`${GRAPH_API}/${text(ctx.settings.phone_number_id)}/messages`, {
      method: "POST", headers: bearerJson(ctx), what: "whatsapp send",
      body: JSON.stringify(template
        ? { messaging_product: "whatsapp", to, type: "template", template: { name: template, language: { code: str(args, "language") || "fa" } } }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: clip(body) } }),
    });
    return { message_id: text(list(sent.messages)[0]?.id) };
  },
};

export function whatsappProfile(data: Record<string, unknown>, phoneId: string): ConnectorItem[] {
  const profile = list(data.data)[0];
  if (!profile) return [];
  return [{
    id: phoneId,
    title: text(profile.about) || "Business profile",
    subtitle: [text(profile.description), text(profile.email), list(profile.websites).length ? String(profile.websites) : ""].filter(Boolean).join(" · "),
    occurred_at: null,
  }];
}

export function whatsappTemplates(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.data).flatMap((template) => text(template.name) ? [{
    id: text(template.id) || text(template.name),
    title: text(template.name),
    subtitle: [text(template.status), text(template.category), text(template.language)].filter(Boolean).join(" · "),
    occurred_at: null,
  }] : []).slice(0, 50);
}

// ─── Dropbox ─────────────────────────────────────────────────────────────────

const DROPBOX_API = "https://api.dropboxapi.com/2";

const dropbox: ProviderDef = {
  provider: "dropbox", brand: "Dropbox", kind: "oauth",
  oauth: {
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: [], extraAuthorize: { token_access_type: "offline" },
    pkce: true, tokenAuth: "body", tokenBody: "form", refreshable: true,
  },
  sources: ["files"],
  actions: [],
  async accountLabel(ctx) {
    const me = await fetchJson(`${DROPBOX_API}/users/get_current_account`, { method: "POST", headers: { authorization: `Bearer ${ctx.bearer}` }, what: "dropbox account" });
    return text(me.email) || text((me.name as Record<string, unknown> | undefined)?.display_name) || "Dropbox account";
  },
  async items(ctx, source) {
    if (source !== "files") throw unknownSource(source);
    const data = await fetchJson(`${DROPBOX_API}/files/list_folder`, {
      method: "POST", headers: bearerJson(ctx), what: "dropbox list_folder",
      body: JSON.stringify({ path: "", limit: 100, include_non_downloadable_files: false }),
    });
    return dropboxEntries(data);
  },
  async act(_ctx, action) { throw unknownAction(action); },
};

export function dropboxEntries(data: Record<string, unknown>): ConnectorItem[] {
  return list(data.entries)
    .flatMap((entry) => text(entry.id) ? [{
      id: text(entry.id),
      title: text(entry.name) || "Untitled",
      subtitle: [text(entry[".tag"]) === "folder" ? "folder" : text(entry.path_display)].filter(Boolean).join(""),
      occurred_at: isoOrNull(entry.server_modified) ?? isoOrNull(entry.client_modified),
    }] : [])
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))
    .slice(0, LIST_LIMIT);
}

// ─── MCP (Model Context Protocol, streamable HTTP) ──────────────────────────

const MCP_PROTOCOL = "2025-06-18";

interface McpReply { result?: Record<string, unknown>; error?: { code?: number; message?: string } }

/**
 * One JSON-RPC call over streamable HTTP. A server may answer as JSON or as
 * an SSE stream carrying the reply; both are read here so callers see one
 * shape. The server's session id (when it issues one) rides on later calls.
 */
async function mcpRequest(
  url: string, bearer: string, session: string | null, method: string, params: Record<string, unknown>, id: number | null,
): Promise<{ reply: McpReply | null; session: string | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  });
  const nextSession = response.headers.get("mcp-session-id") ?? session;
  if (!response.ok) throw new ProviderRefusal(response.status, `mcp ${method}`);
  if (id === null || response.status === 202 || response.status === 204) return { reply: null, session: nextSession };
  const raw = await response.text();
  const type = response.headers.get("content-type") ?? "";
  const reply = type.includes("text/event-stream") ? mcpReplyFromSse(raw, id) : (JSON.parse(raw) as McpReply);
  if (reply?.error) throw new ValidationError(`the MCP server refused ${method}: ${text(reply.error.message).slice(0, 120)}`, { code: "connector_provider_error" });
  return { reply, session: nextSession };
}

/** the reply with our id, out of an SSE body (`data:` lines, blank-line framed) */
export function mcpReplyFromSse(body: string, id: number): McpReply | null {
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as McpReply & { id?: unknown };
      if (parsed.id === id) return parsed;
    } catch { /* a keep-alive or a notification; not ours */ }
  }
  return null;
}

async function mcpSession(url: string, bearer: string): Promise<{ session: string | null; server: Record<string, unknown> }> {
  const init = await mcpRequest(url, bearer, null, "initialize", {
    protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "neurai-platform", version: "1" },
  }, 1);
  await mcpRequest(url, bearer, init.session, "notifications/initialized", {}, null).catch(() => undefined);
  return { session: init.session, server: init.reply?.result ?? {} };
}

const mcp: ProviderDef = {
  provider: "mcp", brand: "MCP server", kind: "token",
  token: { fields: ["url", "secret"], required: ["url"] },
  sources: ["tools", "resources"],
  actions: ["call_tool"],
  async accountLabel(ctx) {
    return text(ctx.settings.server_name) || text(ctx.settings.url) || "MCP server";
  },
  async verify(input) {
    const url = (await assertPublicHttpsUrl((input.url ?? "").trim())).toString();
    const bearer = (input.secret ?? "").trim();
    const { session, server } = await mcpSession(url, bearer);
    const info = server.serverInfo as Record<string, unknown> | undefined;
    const tools = await mcpRequest(url, bearer, session, "tools/list", {}, 2);
    const count = list(tools.reply?.result?.tools).length;
    return {
      /* the bearer may be empty: a public MCP server needs none, and an empty
         secret is stored as the credential "nothing" rather than refused */
      bearer,
      label: text(info?.name) || new URL(url).hostname,
      settings: { url, server_name: text(info?.name), server_version: text(info?.version), protocol_version: text(server.protocolVersion) || MCP_PROTOCOL, tool_count: count },
    };
  },
  async items(ctx, source) {
    const url = text(ctx.settings.url);
    if (!url) throw new ValidationError("this MCP connection has no server URL — reconnect it", { code: "connector_reconnect_required" });
    const { session } = await mcpSession(url, ctx.bearer);
    if (source === "tools") {
      const data = await mcpRequest(url, ctx.bearer, session, "tools/list", {}, 2);
      return mcpTools(data.reply?.result ?? {});
    }
    if (source === "resources") {
      const data = await mcpRequest(url, ctx.bearer, session, "resources/list", {}, 3).catch(() => ({ reply: null, session }));
      return mcpResources(data.reply?.result ?? {});
    }
    throw unknownSource(source);
  },
  async act(ctx, action, args) {
    if (action !== "call_tool") throw unknownAction(action);
    const url = text(ctx.settings.url);
    if (!url) throw new ValidationError("this MCP connection has no server URL — reconnect it", { code: "connector_reconnect_required" });
    const tool = required(args, "tool");
    const rawArguments = args.arguments;
    const toolArguments = rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments) ? rawArguments as Record<string, unknown> : {};
    const { session } = await mcpSession(url, ctx.bearer);
    const data = await mcpRequest(url, ctx.bearer, session, "tools/call", { name: tool, arguments: toolArguments }, 4);
    return mcpCallResult(data.reply?.result ?? {});
  },
};

export function mcpTools(result: Record<string, unknown>): ConnectorItem[] {
  return list(result.tools).flatMap((tool) => text(tool.name) ? [{
    id: text(tool.name),
    title: text(tool.name),
    subtitle: clip(text(tool.description), 160),
    occurred_at: null,
  }] : []).slice(0, 100);
}

export function mcpResources(result: Record<string, unknown>): ConnectorItem[] {
  return list(result.resources).flatMap((resource) => text(resource.uri) ? [{
    id: text(resource.uri),
    title: text(resource.name) || text(resource.uri),
    subtitle: clip(text(resource.description) || text(resource.uri), 160),
    occurred_at: null,
  }] : []).slice(0, 100);
}

/** the text a tool answered with, bounded — a remote tool's output is DATA the caller fences, never instructions */
export function mcpCallResult(result: Record<string, unknown>): Record<string, unknown> {
  const parts = list(result.content).map((part) => part.type === "text" ? text(part.text) : `[${text(part.type) || "content"}]`);
  return { is_error: result.isError === true, text: clip(parts.join("\n"), 8_000) };
}

// ─── the registry ────────────────────────────────────────────────────────────

const REGISTRY: Partial<Record<ConnectorProvider, ProviderDef>> = {
  zoom, slack, telegram, jira, notion, github, whatsapp, dropbox, mcp,
};

/** the definition, or undefined for the two providers connectors.ts speaks to directly */
export function providerDef(provider: ConnectorProvider): ProviderDef | undefined {
  return REGISTRY[provider];
}

/** every provider this file defines — the producer of the web catalogue's coverage list */
export const REGISTRY_PROVIDERS: readonly ConnectorProvider[] = Object.keys(REGISTRY) as ConnectorProvider[];

export function connectorKind(provider: ConnectorProvider): "oauth" | "token" {
  return REGISTRY[provider]?.kind ?? "oauth";
}

function unknownSource(source: string): ValidationError {
  return new ValidationError(`unknown connector source: ${source}`, { code: "connector_source_invalid" });
}

function unknownAction(action: string): ValidationError {
  return new ValidationError(`unknown connector action: ${action}`, { code: "connector_action_invalid" });
}

/**
 * The OAuth app for each provider, from the process environment — one place
 * for the names, read by the api and the worker alike (they used to spell the
 * same six names twice). The Echo-platform secret namespace, never a generic
 * one (rule 3). Every provider reads its OWN pair: the one borrowing
 * arrangement (OneDrive ← Microsoft) left with OneDrive on 2026-09-07, and a
 * borrowing rule with nobody to apply it to is a rule nothing can prove.
 */
export function connectorCredentialsFromEnv(env: Record<string, string | undefined>): Partial<Record<ConnectorProvider, { clientId?: string | undefined; clientSecret?: string | undefined }>> {
  const out: Partial<Record<ConnectorProvider, { clientId?: string | undefined; clientSecret?: string | undefined }>> = {};
  for (const provider of CONNECTOR_PROVIDERS) {
    if (connectorKind(provider) !== "oauth") continue;
    out[provider] = {
      clientId: env[`echo_platform_${provider}_oauth_client_id`],
      clientSecret: env[`echo_platform_${provider}_oauth_client_secret`],
    };
  }
  return out;
}
