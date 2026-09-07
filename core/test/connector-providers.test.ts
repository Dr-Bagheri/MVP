import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_PROVIDERS, connectorCredentialsFromEnv, connectorKind, dropboxEntries, githubIssues, githubRepos,
  isPrivateAddress, jiraIssues, jiraProjects, mcpCallResult, mcpReplyFromSse, mcpTools, notionResults, notionTitle,
  providerDef, REGISTRY_PROVIDERS, slackChannels, slackMentions, telegramUpdates, whatsappTemplates,
  zoomMeetings, zoomRecordings,
} from "../src/api/connector-providers.ts";
import { connectorSources } from "../src/api/connectors.ts";
import { OFFERED_CONNECTOR_PROVIDERS } from "../src/api/vocabulary.ts";

/**
 * THE REGISTRY (2026-09-06). Nothing here reaches a provider — the shapes
 * below are transcribed from each provider's published response documents,
 * which is the honest ceiling before a grant exists; the live proof is the
 * acceptance run with a real account and it is recorded, not assumed. What a
 * test CAN establish is decided here: the seams (the migration's list equals
 * the code's, every offered provider has an entry, every entry's sources and
 * actions name real things), the mappers (a provider's list becomes items
 * with a title, a subtitle and a time — and nothing else), and the two
 * pieces of parsing that fail silently when wrong (an SSE-framed MCP reply,
 * a private address hiding behind a hostname).
 */
describe("the registry is one list everywhere", () => {
  it("the db provider check names exactly the code's providers", () => {
    /* the OWNING migration is derived, not named: 0199 wrote this check and
       0203 narrowed it, and a test pinned to the file that happened to write
       it first reports the CURRENT wall wrong the moment the wall moves */
    const dir = join(process.cwd(), "..", "db", "migrations");
    const owner = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && readFileSync(join(dir, f), "utf8").includes("connector_connection_provider_check"))
      .sort().pop();
    expect(owner, "no migration defines the provider check").toBeDefined();
    const sql = readFileSync(join(dir, owner!), "utf8");
    const check = /provider in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? "";
    const names = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...CONNECTOR_PROVIDERS].sort());
    /* the control: a provider the product no longer speaks is not permitted */
    expect(names).not.toContain("onedrive");
  });

  it("every OFFERED provider is one the code can speak, and every registry provider is offered", () => {
    for (const provider of OFFERED_CONNECTOR_PROVIDERS) expect(CONNECTOR_PROVIDERS).toContain(provider);
    for (const provider of REGISTRY_PROVIDERS) expect(OFFERED_CONNECTOR_PROVIDERS as readonly string[]).toContain(provider);
    /* the control: Microsoft is deliberately not offered */
    expect(OFFERED_CONNECTOR_PROVIDERS as readonly string[]).not.toContain("microsoft");
  });

  it("every registry entry has sources, a kind, and — for OAuth — a token endpoint; token kinds a verify()", () => {
    for (const provider of REGISTRY_PROVIDERS) {
      const def = providerDef(provider)!;
      expect(def.sources.length, provider).toBeGreaterThan(0);
      expect(connectorSources(provider)).toEqual(def.sources);
      if (def.kind === "oauth") {
        expect(def.oauth?.tokenUrl, provider).toMatch(/^https:\/\//);
        expect(def.oauth?.authorizeUrl, provider).toMatch(/^https:\/\//);
      } else {
        expect(typeof def.verify, provider).toBe("function");
        expect(def.token?.required.length, provider).toBeGreaterThan(0);
      }
    }
    expect(connectorKind("telegram")).toBe("token");
    expect(connectorKind("zoom")).toBe("oauth");
    /* the legacy two are OAuth and have their own source lists */
    expect(connectorSources("google")).toEqual(["mail", "calendar", "drive", "meet"]);
    expect(connectorKind("google")).toBe("oauth");
  });

  it("reads the OAuth apps from the environment by each provider's OWN name, and only its own", () => {
    const env = {
      echo_platform_zoom_oauth_client_id: "z-id", echo_platform_zoom_oauth_client_secret: "z-secret",
      echo_platform_microsoft_oauth_client_id: "m-id", echo_platform_microsoft_oauth_client_secret: "m-secret",
    };
    const creds = connectorCredentialsFromEnv(env);
    expect(creds.zoom).toEqual({ clientId: "z-id", clientSecret: "z-secret" });
    /* nobody borrows: the one borrowing arrangement (OneDrive ← Microsoft)
       left with OneDrive on 2026-09-07, and a pair sitting under ANOTHER
       provider's name must not configure this one — which is the assertion a
       re-introduced fallback would fail */
    expect(creds.microsoft).toEqual({ clientId: "m-id", clientSecret: "m-secret" });
    expect(creds.slack).toEqual({ clientId: undefined, clientSecret: undefined });
    expect(creds.slack?.clientId).toBeUndefined();
    /* token kinds have no app at all */
    expect(creds.telegram).toBeUndefined();
    expect(creds.mcp).toBeUndefined();
  });
});

describe("the mappers: a provider's list becomes items and nothing more", () => {
  it("zoom", () => {
    expect(zoomMeetings({ meetings: [{ id: 91, topic: "Sprint", start_time: "2026-09-10T08:30:00Z", join_url: "https://zoom.us/j/91" }, { topic: "no id" }] }))
      .toEqual([{ id: "91", title: "Sprint", subtitle: "https://zoom.us/j/91", occurred_at: "2026-09-10T08:30:00.000Z" }]);
    expect(zoomRecordings({ meetings: [{ uuid: "u1", topic: "Kickoff", start_time: "2026-09-01T10:00:00Z", recording_files: [{}, {}] }] }))
      .toEqual([{ id: "u1", title: "Kickoff", subtitle: "2 files", occurred_at: "2026-09-01T10:00:00.000Z" }]);
  });

  it("slack — channels and mentions, with the unix ts read as a time", () => {
    expect(slackChannels({ channels: [{ id: "C1", name: "general", topic: { value: "Company-wide" }, num_members: 12 }] }))
      .toEqual([{ id: "C1", title: "#general", subtitle: "Company-wide", occurred_at: null }]);
    const [mention] = slackMentions({ messages: { matches: [{ ts: "1725600000.000100", text: "<@U1> can you look?", channel: { name: "dev" }, username: "sina" }] } });
    expect(mention).toMatchObject({ id: "1725600000.000100", title: "<@U1> can you look?", subtitle: "#dev · sina" });
    expect(mention!.occurred_at).toBe(new Date(1725600000 * 1000).toISOString());
  });

  it("telegram — newest first, named by the chat, previewed by the text", () => {
    const items = telegramUpdates({ result: [
      { message: { message_id: 1, date: 1725600000, chat: { id: 5, first_name: "Sara", type: "private" }, text: "سلام" } },
      { message: { message_id: 2, date: 1725600100, chat: { id: -100, title: "Team", type: "supergroup" }, text: "ok" } },
      { edited_message: {} },
    ] });
    expect(items.map((i) => i.title)).toEqual(["Team", "Sara"]);
    expect(items[0]).toMatchObject({ id: "-100:2", subtitle: "ok" });
  });

  it("jira — issues carry key, status and the site link; projects carry their key", () => {
    const [issue] = jiraIssues({ issues: [{ key: "NEUR-7", fields: { summary: "Fix STT", status: { name: "In Progress" }, project: { name: "NeurAI" }, updated: "2026-09-05T12:00:00.000+0000" } }] }, "https://x.atlassian.net");
    expect(issue).toMatchObject({ id: "NEUR-7", title: "NEUR-7 · Fix STT", subtitle: "In Progress · NeurAI · https://x.atlassian.net/browse/NEUR-7" });
    expect(jiraProjects({ values: [{ key: "NEUR", name: "NeurAI", projectTypeKey: "software" }] }))
      .toEqual([{ id: "NEUR", title: "NEUR · NeurAI", subtitle: "software", occurred_at: null }]);
  });

  it("notion — the title is whichever property is a title; a database's is top-level", () => {
    expect(notionTitle({ properties: { Name: { type: "title", title: [{ plain_text: "Road" }, { plain_text: "map" }] }, Tags: { type: "multi_select" } } })).toBe("Roadmap");
    expect(notionTitle({ title: [{ plain_text: "Tasks DB" }] })).toBe("Tasks DB");
    expect(notionResults({ results: [{ id: "p1", url: "https://notion.so/p1", last_edited_time: "2026-09-04T08:00:00.000Z", properties: { title: { type: "title", title: [{ plain_text: "Plan" }] } } }] }))
      .toEqual([{ id: "p1", title: "Plan", subtitle: "https://notion.so/p1", occurred_at: "2026-09-04T08:00:00.000Z" }]);
  });

  it("github — a bare array rides under items; a PR is named as one", () => {
    const [issue] = githubIssues({ items: [{ number: 12, title: "Bug", html_url: "https://github.com/o/r/pull/12", updated_at: "2026-09-03T00:00:00Z", repository_url: "https://api.github.com/repos/o/r", pull_request: {} }] });
    expect(issue).toMatchObject({ id: "12", title: "#12 · Bug", subtitle: "o/r · pull request · https://github.com/o/r/pull/12" });
    expect(githubRepos({ items: [{ full_name: "o/r", description: "d", updated_at: "2026-09-03T00:00:00Z" }] })[0]).toMatchObject({ id: "o/r", title: "o/r" });
  });

  it("whatsapp templates, dropbox entries newest first", () => {
    expect(whatsappTemplates({ data: [{ id: "t1", name: "hello_world", status: "APPROVED", category: "UTILITY", language: "fa" }] }))
      .toEqual([{ id: "t1", title: "hello_world", subtitle: "APPROVED · UTILITY · fa", occurred_at: null }]);
    const entries = dropboxEntries({ entries: [
      { ".tag": "file", id: "id:a", name: "old.pdf", path_display: "/old.pdf", server_modified: "2026-01-01T00:00:00Z" },
      { ".tag": "file", id: "id:b", name: "new.pdf", path_display: "/new.pdf", server_modified: "2026-09-01T00:00:00Z" },
      { ".tag": "folder", id: "id:c", name: "Docs", path_display: "/Docs" },
    ] });
    expect(entries.map((e) => e.title)).toEqual(["new.pdf", "old.pdf", "Docs"]);
  });

  it("mcp — tools become items; a call's text is bounded and flagged when the server says error", () => {
    expect(mcpTools({ tools: [{ name: "search", description: "Search the wiki", inputSchema: {} }] }))
      .toEqual([{ id: "search", title: "search", subtitle: "Search the wiki", occurred_at: null }]);
    expect(mcpCallResult({ content: [{ type: "text", text: "hello" }, { type: "image", data: "…" }], isError: true }))
      .toEqual({ is_error: true, text: "hello\n[image]" });
  });
});

describe("the two parsers that fail silently when wrong", () => {
  it("reads OUR reply out of an SSE stream and ignores everything else in it", () => {
    const body = [
      "event: message", "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}", "",
      ": keep-alive", "",
      "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"a\"}]}}", "",
    ].join("\n");
    expect(mcpReplyFromSse(body, 2)?.result).toEqual({ tools: [{ name: "a" }] });
    /* the control: a different id is not ours */
    expect(mcpReplyFromSse(body, 9)).toBeNull();
  });

  it("names a private address in every family it can hide in", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
