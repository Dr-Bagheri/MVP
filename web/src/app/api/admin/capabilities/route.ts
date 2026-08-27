import { coreFetch, errorResponse } from "@/server/core";

/** Member privileges (db/0101) — admin-walled at core, forwarded here. */
export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/admin/capabilities"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      role?: string; capability?: string; allowed?: boolean;
    };
    return Response.json(
      await coreFetch("/v1/admin/capabilities", { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
