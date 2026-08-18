import { coreFetch, errorResponse } from "@/server/core";
import type { ConnectorStatus } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<{ connectors: ConnectorStatus[] }>("/v1/connectors"));
  } catch (error) {
    return errorResponse(error);
  }
}
