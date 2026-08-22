import { coreFetch, errorResponse } from "@/server/core";
import type { PlatformPage, PlatformOrganization } from "@echo/core/wire";

/** Organizations are born HERE (db/0082): root-walled create, with reason. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string; locale?: string; reason?: string;
    };
    const created = await coreFetch<{ id: string | null }>(
      "/v1/platform/organizations",
      { method: "POST", body: { name: body.name, locale: body.locale, reason: body.reason } },
    );
    return Response.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

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
