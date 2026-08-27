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

/**
 * Every key core accepts, written out.
 *
 * This list IS the bug that made "Save changes" report Not saved (user
 * report, 2026-08-26): the handler forwarded three keys and dropped
 * everything else, so a Location edit — and the glossary, which had never
 * saved through here — reached core as an empty patch, and core answered
 * "nothing to update" with a 400. The form was right, the server was
 * right, and the hop between them quietly threw the instruction away.
 *
 * Kept explicit rather than spreading the body: `{name: undefined}`
 * serialises away while `{name: null}` does not, and that difference is
 * how "leave it alone" is told apart from "clear it". A spread would
 * collapse the two. The price of an explicit list is that it can go stale
 * — which is exactly what happened — so org-route.guard.test.ts now fails
 * when core learns a key this list has not.
 */
export const WRITABLE_ORG_KEYS = [
  "name",
  "locale",
  "allowed_models",
  "glossary",
  "public_email",
  "description",
  "website_url",
  "location",
  "logo_url",
  "social_links",
  "autonomy_ceiling",
  "allowed_email_domains",
] as const;

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  /* Forwarded key-by-key, and ABSENT STAYS ABSENT: only what the caller
     actually supplied is passed on, so the server sees the same
     distinction the form made. */
  const patch: Record<string, unknown> = {};
  for (const key of WRITABLE_ORG_KEYS) {
    if (key in body) patch[key] = body[key];
  }

  try {
    return Response.json(
      await coreFetch<OrgRecord>("/v1/admin/org", { method: "PATCH", body: patch }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
