import { coreFetch, errorResponse } from "@/server/core";
import type { OrgRecord } from "@/api/types";

/**
 * The organization row — read and write, and **the paths are the whole story
 * of this file.**
 *
 * The read was asking for `/v1/admin/org`, which core deliberately never
 * registered. Its comment says so directly, above the PATCH:
 *
 *   > There is deliberately NO `GET /v1/admin/org`: it would return the same
 *   > row with the same columns as `GET /v1/org`
 *
 * So the read lives at `/v1/org` (any active member — the shell shows the org
 * name) and only the WRITE is admin-gated. The old path returned an honest
 * 404, and that 404 was recorded as *the feature is not built* — which held a
 * read-only notice on the settings form for weeks. **"No such route" and "no
 * such feature" are different nothings, and a 404 from our own BFF looks
 * identical whichever it is.** It is worth writing that down here, because the
 * next person to see a 404 from this layer will be one path-string away from
 * the same conclusion.
 *
 * Two other corrections, both checked against `server.ts` rather than assumed:
 *
 * **The model allow-list is a field on the org, not a route.** This handler
 * used to PATCH `/v1/admin/models/{id}`; core registers only `GET /v1/models`
 * and `PUT /v1/models/preferred`, so that branch could never have worked.
 * Curation travels as `allowed_models` on the org update.
 *
 * **`default_call_scope` is not on this wire.** Core's `OrgRecord` carries
 * `{id, name, status, locale, allowed_models, created_at}`, and its update
 * accepts `name`, `locale` and `allowed_models`. The old body sent the one
 * field core ignores and omitted the two it accepts, so a save appeared to
 * work and changed nothing.
 *
 * `status` is not writable here and must not become so: org status is
 * vendor-only at the database guard (D27), because a transition that removes
 * the actor's power to reverse it needs its exit built with its entrance.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<OrgRecord>("/v1/org"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    name?: string | null;
    locale?: string | null;
    allowed_models?: string[];
  };

  /*
   * Forwarded key-by-key, and **absent stays absent**. `null` clears a field
   * and omitting it leaves the field alone — two different instructions that
   * a spread of the whole body would collapse, since `{name: undefined}`
   * serialises away but `{name: null}` does not. Only what the caller actually
   * supplied is passed on, so the server sees the same distinction the form
   * made.
   */
  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = body.name;
  if ("locale" in body) patch.locale = body.locale;
  if ("allowed_models" in body) patch.allowed_models = body.allowed_models;

  try {
    return Response.json(
      await coreFetch<OrgRecord>("/v1/admin/org", { method: "PATCH", body: patch }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
