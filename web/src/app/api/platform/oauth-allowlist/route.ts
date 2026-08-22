import { coreFetch, errorResponse } from "@/server/core";

/** The OAuth allow-list (db/0082) — platform-root only; core is the wall. */

export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ entries: unknown[] }>("/v1/platform/oauth-allowlist"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string; note?: string; reason?: string;
    };
    return Response.json(
      await coreFetch<{ allowed: boolean }>("/v1/platform/oauth-allowlist", {
        method: "POST",
        body: { email: body.email, note: body.note, reason: body.reason },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; reason?: string };
    await coreFetch<null>("/v1/platform/oauth-allowlist", {
      method: "DELETE",
      body: { email: body.email, reason: body.reason },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
