import { coreFetch, errorResponse } from "@/server/core";
import type { PlatformPage, PlatformUser } from "@echo/core/wire";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).search;
    return Response.json(await coreFetch<PlatformPage<PlatformUser>>(`/v1/platform/users${query}`));
  } catch (error) {
    return errorResponse(error);
  }
}
