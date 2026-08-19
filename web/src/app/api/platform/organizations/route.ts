import { coreFetch, errorResponse } from "@/server/core";
import type { PlatformPage, PlatformOrganization } from "@echo/core/wire";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).search;
    return Response.json(
      await coreFetch<PlatformPage<PlatformOrganization>>(`/v1/platform/organizations${query}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
