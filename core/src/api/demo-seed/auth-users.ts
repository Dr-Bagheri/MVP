/**
 * The demo seed's auth identities (M52).
 *
 * `echo.app_user.id` IS the `auth.users.id` for a human — db/0171 replaced the
 * foreign key with a trigger that still demands the identity exists — so a
 * demo organisation's five accounts have to exist in Supabase Auth BEFORE the
 * database door can seat them. Nothing else in core creates an auth user:
 * invitations use `POST /auth/v1/invite`, which emails a real person a
 * set-password link. A demo presenter is handed their password in the console
 * and there is no mailbox behind `@demo.neurai.invalid`, so this is the one
 * caller of the admin create-user endpoint.
 *
 * THE PASSWORD. 24 characters from a CSPRNG over a 68-character alphabet
 * (~146 bits), returned once to the console and never written down by us —
 * not in a row, not in a log, not in the audit line. If the operator loses it
 * the answer is a password reset, not a lookup, and that is the property
 * worth having.
 *
 * THE CLEAN-UP. Identities are created before the transaction that seats
 * them, so a failure after that point leaves auth users with no organisation.
 * `remove` exists for exactly that unwind, and the caller REPORTS what it
 * could not remove rather than swallowing it: an orphaned identity is a real
 * thing an operator may have to delete by hand, and the only way they learn
 * about it is if we say so.
 */

import { randomInt } from "node:crypto";

/** No look-alikes: 0/O and 1/l/I are removed, because this is READ ALOUD. */
const ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_@#";
const PASSWORD_LENGTH = 24;

export function generatePassword(length: number = PASSWORD_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthAdmin {
  create(email: string, password: string): Promise<AuthUser>;
  remove(id: string): Promise<void>;
}

export interface AuthAdminConfig {
  url: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

export class AuthAdminError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthAdminError";
    this.status = status;
  }
}

export function createAuthAdmin(config: AuthAdminConfig): AuthAdmin {
  const base = config.url.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${config.serviceKey}`,
    apikey: config.serviceKey,
    "content-type": "application/json",
  };

  return {
    async create(email, password) {
      const response = await doFetch(`${base}/auth/v1/admin/users`, {
        method: "POST",
        headers,
        /* `email_confirm` because there is no mailbox to confirm from: a demo
           account that had to click a link nobody receives is an account that
           cannot sign in, which is the one thing this must not produce. */
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (!response.ok) {
        /* status only — the body of an auth error can quote the address and,
           on some failures, the payload we sent */
        throw new AuthAdminError(
          `could not create the demo identity (HTTP ${response.status})`,
          response.status,
        );
      }
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== "string" || body.id === "") {
        throw new AuthAdminError("the auth service returned no id", 502);
      }
      return { id: body.id, email };
    },

    async remove(id) {
      const response = await doFetch(
        `${base}/auth/v1/admin/users/${encodeURIComponent(id)}`,
        { method: "DELETE", headers },
      );
      /* already gone is the outcome we wanted — the same absence-at-the-
         adapter rule the purge learned */
      if (response.ok || response.status === 404) return;
      throw new AuthAdminError(
        `could not remove the demo identity (HTTP ${response.status})`,
        response.status,
      );
    },
  };
}

export function authAdminFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthAdmin | null {
  const url = env.SUPABASE_URL ?? "";
  const serviceKey = env.SUPABASE_SERVICE_KEY ?? "";
  if (url === "" || serviceKey === "") return null;
  return createAuthAdmin({ url, serviceKey });
}

/**
 * The presenter's address, and everybody else's.
 *
 * `.invalid` is reserved by RFC 2606 and can never be delivered to, which is
 * the property that matters: a demo account must not be able to receive a
 * password-reset mail, and an address that merely LOOKS fake (example.com)
 * is a domain somebody owns. The date is in the local part so two demos of
 * the same organisation on different days do not collide on Supabase's
 * global unique email.
 */
export const DEMO_EMAIL_DOMAIN = "demo.neurai.invalid";

export function demoSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  /* a Persian organisation name folds to nothing here, and an empty local
     part is not an address — "demo" is the honest fallback, and the date
     plus the username still make it unique */
  return slug === "" ? "demo" : slug;
}

export function demoEmail(username: string, slug: string, demoDate: string): string {
  const stamp = demoDate.replace(/-/g, "");
  return `${username}-${slug}-${stamp}@${DEMO_EMAIL_DOMAIN}`;
}

/** The presenter's default address, the one the form pre-fills. */
export function presenterEmail(slug: string, demoDate: string): string {
  const stamp = demoDate.replace(/-/g, "");
  return `demo-${slug}-${stamp}@${DEMO_EMAIL_DOMAIN}`;
}
