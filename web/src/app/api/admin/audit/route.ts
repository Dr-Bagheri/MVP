import { coreFetch, errorResponse } from "@/server/core";
import type { AuditPage } from "@/api/types";

/**
 * The audit feed (M25, Settings · COMPLIANCE) — one hop, no opinions.
 *
 * `limit`, `source` and the three cursor parts are **forwarded, never applied
 * here.** The feed is a union across three tables ordered and paged in SQL;
 * re-deriving any part of that in this layer would make the BFF a second
 * implementation of an ordering rule that only reads correctly in one place.
 * The server owns the query, this layer owns the hop.
 *
 * The cursor travels as `cursor_at` / `cursor_source` / `cursor_id` — the same
 * three fields the feed's ORDER BY uses, compared row-wise. They are forwarded
 * individually and **never recombined or re-parsed**: `cursor_at` carries
 * Postgres's microsecond text, and passing it through anything that
 * understands timestamps would truncate it to milliseconds and quietly
 * re-open the page-boundary skip the composite cursor closed. Text in, text
 * out. A partial cursor is not repaired here either — core/ names it as a
 * caller mistake, which is more useful than a page silently computed from two
 * thirds of a boundary.
 *
 * `source` in particular is forwarded UNVALIDATED on purpose. core/ answers an
 * unknown source with a 400 that names the accepted values; a check here that
 * quietly dropped the parameter would return the unfiltered feed instead — and
 * a filter that silently stops filtering reads as "nothing was excluded",
 * which on an audit screen is the exact opposite of the truth the reader
 * asked for. One refusal beats a convincing full list.
 *
 * Nothing is reshaped on the way through. `AuditEntry` is core/'s own
 * published type (`@echo/core/wire`), so the body that leaves core/ is the
 * body that reaches the browser, and a field rename upstream is a compile
 * error here rather than an `undefined` on screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["limit", "source", "cursor_at", "cursor_source", "cursor_id"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";

  try {
    return Response.json(await coreFetch<AuditPage>(`/v1/admin/audit${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}
