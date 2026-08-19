import { coreFetch, errorResponse } from "@/server/core";
import type { PlatformAuditEntry, PlatformPage } from "@echo/core/wire";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).search;
    return Response.json(await coreFetch<PlatformPage<PlatformAuditEntry>>(`/v1/platform/audit${query}`));
  } catch (error) {
    return errorResponse(error);
  }
}
