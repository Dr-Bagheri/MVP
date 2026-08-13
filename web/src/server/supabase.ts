/**
 * SERVER ONLY — the sign-in hop to Supabase Auth (GoTrue).
 *
 * Deliberately raw `fetch` rather than `@supabase/supabase-js`: the only
 * thing web/ needs from Supabase is a token exchange, and the client library
 * would bring a session manager that wants to keep the token in browser
 * storage. M1 says the browser never holds a token — so the piece we'd have
 * to fight is the piece we'd be importing it for.
 *
 * The PUBLISHABLE key is public by design (it ships in every browser bundle
 * of every Supabase app); it is an identifier, not a secret. The service key
 * must never appear in web/ at all — core/ holds its own credentials.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function config(): { url: string; key: string } {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    /*
     * Fail loudly and specifically. A missing env var here would otherwise
     * surface as a confusing 401 from Supabase — "your credentials are
     * wrong" when the truth is "there were no credentials", which is a
     * different kind of nothing and sends whoever debugs it the wrong way.
     */
    throw new AuthError(500, "Supabase is not configured (URL or publishable key missing)");
  }
  return { url: SUPABASE_URL, key: PUBLISHABLE_KEY };
}

async function gotrue(path: string, body: unknown): Promise<TokenSet> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (cause) {
    // unreachable auth provider is upstream, not "bad password"
    throw new AuthError(502, `auth provider unreachable: ${cause instanceof Error ? cause.message : "fetch failed"}`);
  }

  const data = (await response.json().catch(() => ({}))) as Partial<TokenSet> & {
    error_description?: string;
    msg?: string;
  };

  if (!response.ok) {
    /*
     * Status passed through as-is. This used to fold 400 → 401, which is
     * correct for SIGN-IN (GoTrue 400s a wrong password, and that is an
     * authentication failure) and wrong for SIGN-UP, where a 400 means the
     * input was rejected — a malformed or non-deliverable email address is
     * not a credentials problem. Folding them made a validation error read as
     * "wrong password", which sends whoever hits it looking for the wrong
     * thing entirely. The sign-in caller does its own mapping.
     */
    throw new AuthError(response.status, data.error_description ?? data.msg ?? "auth request failed");
  }
  if (!data.access_token || !data.refresh_token) {
    throw new AuthError(502, "auth provider returned no token");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in ?? 3600,
  };
}

/**
 * Email + password. Returns the token set; the CALLER puts it in the cookie.
 *
 * GoTrue 400s a wrong password, which IS an authentication failure here — so
 * this is the one place that fold is correct, and it lives here rather than
 * in the shared helper where sign-up would inherit it.
 */
export async function signInWithPassword(email: string, password: string): Promise<TokenSet> {
  try {
    return await gotrue("/token?grant_type=password", { email, password });
  } catch (error) {
    if (error instanceof AuthError && error.status === 400) {
      throw new AuthError(401, error.message);
    }
    throw error;
  }
}

/**
 * Create the AUTH identity. This is only half of signing up: it produces a
 * token, and the person still does not exist to the product until core/'s
 * `POST /v1/signup` inserts their `app_user` row. Skipping that second half
 * is what made M15 unreachable — a valid token whose owner 401s forever and
 * never reaches an admin's pending queue.
 *
 * Depending on project settings, Supabase may return no session here (email
 * confirmation required). That is not an error, and the caller must not
 * treat a missing token as a failed sign-up.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<TokenSet | null> {
  try {
    return await gotrue("/signup", { email, password });
  } catch (error) {
    if (error instanceof AuthError && error.status === 502 && /no token/.test(error.message)) {
      return null; // created, but confirmation is pending — not a failure
    }
    throw error;
  }
}

/** Exchange a refresh token — used when the access token has expired. */
export function refresh(refreshToken: string): Promise<TokenSet> {
  return gotrue("/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

/**
 * The URL a user is sent to for Google. `redirectTo` must be an allow-listed
 * URL in the Supabase project, and the code comes back to our callback route
 * — never to the browser as a token.
 */
export function googleAuthorizeUrl(redirectTo: string): string {
  const { url } = config();
  const params = new URLSearchParams({ provider: "google", redirect_to: redirectTo });
  return `${url}/auth/v1/authorize?${params}`;
}
