import { coreFetch, errorResponse } from "@/server/core";
import type { ConnectorItem } from "@/api/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string; source: string }> },
) {
  try {
    const { provider, source } = await params;
    return Response.json(await coreFetch<{ items: ConnectorItem[] }>(
      `/v1/connectors/${encodeURIComponent(provider)}/${encodeURIComponent(source)}`,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
