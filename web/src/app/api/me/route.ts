import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Who the caller is. The shell, the profile screen and every admin
 * affordance depend on this.
 *
 * It has to be a round trip: the browser never holds the token (M1), so it
 * cannot read the JWT to find out who it is — and it shouldn't anyway, since
 * core/ resolves `role` from the DATABASE rather than from the token. A token
 * minted a minute ago can be stale about a role that changed since.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<User>("/v1/me"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The caller edits their own names (M24 round 1): `display_name`,
 * `display_name_en`, `username`.
 *
 * **Three states, not two.** A key that is absent means "leave it alone"; a
 * key sent as `null` means "clear it". core/ carries that distinction all the
 * way to SQL — the reflex `coalesce($n, column)` cannot express the second at
 * all, and the bug it produces is invisible: everything saves, except that
 * removing your Latin name silently does nothing.
 *
 * So this handler must not "clean up" the body. Rebuilding it from a
 * whitelist is safe — an absent key becomes `undefined` and JSON.stringify
 * drops it, while an explicit `null` survives — but anything that coalesced
 * or defaulted here would collapse the two and there would be no error
 * anywhere to notice it by.
 *
 * `locale` and `model_id` are NOT accepted, because this route does not have
 * them: core/ reads exactly three fields and ignores the rest in silence, so
 * forwarding them would produce a successful save that saved nothing. The
 * model preference has its own route (`PUT /v1/models/preferred`).
 */
export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  /*
   * The allow-list is WRITTEN OUT, matching core/'s own. A derived list grows
   * a hole the moment a field is added to the type and forgotten here — which
   * is the same failure one layer along.
   *
   * `calendar`, `timezone` and `locale` join the three names because core/ now
   * serves and accepts them. They were the reverse of a missing feature:
   * `app_user.locale` existed all along, NOT NULL, and nothing selected it, so
   * a preference that should follow someone between devices was invisible to
   * every client. I reported it as "core has no locale column"; B1 read the
   * catalogue instead of taking my word, and a column nobody reads turns out to
   * look exactly like a column that isn't there.
   *
   * Not forwarding an unknown key is no longer merely tidy: core/ answers one
   * with `400 unknown_fields` now, so a typo here surfaces as a refusal that
   * names the field instead of a save that quietly drops it.
   */
  const ALLOWED = [
    "display_name", "display_name_en", "username", "avatar_url",
    "calendar", "timezone", "locale",
    "job_title", "about", "assistant_context",
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED) if (key in body) patch[key] = body[key];

  try {
    return Response.json(await coreFetch<User>("/v1/me", { method: "PATCH", body: patch }));
  } catch (error) {
    // 400 → `invalid` and 409 → `conflict`, both carrying core/'s sentence:
    // it owns the username rule and the taken/retired distinction, and the
    // form states what it is told rather than re-deriving either.
    return errorResponse(error);
  }
}
