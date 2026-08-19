import { coreFetch, errorResponse } from "@/server/core";
import type { PlatformOverview } from "@echo/core/wire";

export async function GET() {
  try {
    return Response.json(await coreFetch<PlatformOverview>("/v1/platform/overview"));
  } catch (error) {
    return errorResponse(error);
  }
}
