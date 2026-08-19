import { coreFetch, errorResponse } from "@/server/core";

/** A caller may learn only their own platform-root status. */
export async function GET() {
  try {
    return Response.json(await coreFetch<{ platform_root: boolean }>("/v1/platform/access"));
  } catch (error) {
    return errorResponse(error);
  }
}
