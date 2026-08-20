import { coreFetch, errorResponse } from "@/server/core";

/** M36: the autonomy dial — its own door, like the model preference. */
export async function PUT(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/me/autonomy", {
        method: "PUT",
        body: await request.json(),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
