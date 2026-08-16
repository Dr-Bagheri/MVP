import { coreFetch, errorResponse } from "@/server/core";

/**
 * The curation menu (Part 3): the whole offered catalogue with per-model
 * allow flags, admin-only. This route existing is what retired the
 * "choices on this page are not saved" banner — the WRITE has always been
 * PATCH /v1/admin/org carrying allowed_models.
 */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{
        models: { id: string; name: string; allowed: boolean; suggested: boolean; tools?: boolean }[];
        curated: boolean;
      }>("/v1/admin/models"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
