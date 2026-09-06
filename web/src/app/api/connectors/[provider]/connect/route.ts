import { coreFetch, errorResponse, readJson } from "@/server/core";
import { CONNECTOR_PROVIDERS } from "@echo/core/vocabulary";
import type { ConnectorStatus } from "@/api/types";

/**
 * POST /api/connectors/[provider]/connect — a PASTED credential (2026-09-06):
 * Telegram's bot token, WhatsApp's token and number, an MCP server's URL and
 * bearer. The body goes to core as it came; core's registry names the fields
 * a provider accepts and asks the provider to vouch for the credential BEFORE
 * anything is stored. This layer carries identity and nothing else — the
 * secret crosses it once, in flight, and is never read here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    if (!(CONNECTOR_PROVIDERS as readonly string[]).includes(provider)) {
      return Response.json({ error: "unknown provider" }, { status: 400 });
    }
    const body = await readJson(request) as Record<string, unknown>;
    return Response.json(await coreFetch<ConnectorStatus>(
      `/v1/connectors/${encodeURIComponent(provider)}/connect`,
      { method: "POST", body },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
