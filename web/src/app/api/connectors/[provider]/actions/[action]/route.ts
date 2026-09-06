import { coreFetch, errorResponse, readJson } from "@/server/core";
import { CONNECTOR_PROVIDERS } from "@echo/core/vocabulary";

/**
 * POST /api/connectors/[provider]/actions/[action] — a connector ACTION
 * (2026-09-06): post a Slack or Telegram or WhatsApp message, create a Jira
 * or GitHub issue, a Notion page, a Zoom meeting, call an MCP tool. Reached
 * from a CLIENT tool in the person's browser — behind the consent card, on
 * their own session — and from nowhere else: the server-side runs hold no
 * route to it. The body is `{args}`; core's registry validates the arguments
 * like human input and performs on the person's own grant.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string; action: string }> },
) {
  try {
    const { provider, action } = await params;
    if (!(CONNECTOR_PROVIDERS as readonly string[]).includes(provider) || !/^[a-z_]{3,40}$/.test(action)) {
      return Response.json({ error: "unknown connector action" }, { status: 400 });
    }
    const body = await readJson(request) as { args?: unknown };
    return Response.json(await coreFetch<{ result: Record<string, unknown> }>(
      `/v1/connectors/${encodeURIComponent(provider)}/actions/${encodeURIComponent(action)}`,
      { method: "POST", body: { args: body.args ?? {} } },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
