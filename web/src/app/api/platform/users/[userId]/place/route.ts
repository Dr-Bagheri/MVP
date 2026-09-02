import { coreFetch, errorResponse } from "@/server/core";

/**
 * Place a pending arrival into an organisation. Vendor-only; core's route
 * requires platform-root and the database door refuses any status but
 * `pending`, so this layer forwards and decides nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  try {
    return Response.json(await coreFetch<{ placed: boolean }>(`/v1/platform/users/${userId}/place`, {
      method: "POST", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
