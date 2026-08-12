/**
 * Signed download URLs for stored audio.
 *
 * Why this exists at all (invariant 6): ml/ is productless — it holds no
 * credential of ours and knows nothing about calls, orgs or users. So audio
 * cannot be handed to it as "fetch this with our key"; it has to arrive as a
 * URL that carries its own authority and expires on its own. A leaked signed
 * URL dies. A leaked service key does not.
 *
 * ── Two rules this module exists to keep ────────────────────────────────────
 *
 * 1. It refuses to CONSTRUCT when unconfigured, rather than failing per job.
 *    A worker that starts and then dead-letters every part looks like a
 *    pipeline bug for an hour before anyone thinks to check the config.
 *    Requested by Backend 2, endorsed by the steward, and it is the reason
 *    `createStorageSigner` throws instead of returning a signer that throws.
 *
 * 2. NOTHING here logs, and no error carries a URL, a key or a response body.
 *    A signed URL IS a credential — logging one is the same class of mistake
 *    as logging the key that minted it, and the response body is where the
 *    signed URL lives. Errors carry the HTTP status and nothing else.
 *
 * The service key is used ONLY to mint URLs, and only in this file. It never
 * travels with the audio.
 */

/**
 * The shape the worker codes against (`worker/steps.ts` declares the same
 * interface structurally, which is why this satisfies it today without an
 * import). TTL is a parameter, not a constant: an hour suits a typical part,
 * and a long part on a slow lane wants headroom without patching a module.
 */
export interface StorageSigner {
  signDownload(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

export interface StorageSignerConfig {
  /** Project URL, e.g. https://xxx.supabase.co — NOT the storage path. */
  url: string;
  /** Service key. Held only here, only to sign; never sent with the audio. */
  serviceKey: string;
  fetchImpl?: typeof fetch | undefined;
}

export class StorageConfigError extends Error {}
export class StorageSignError extends Error {}

const MAX_TTL_SEC = 24 * 60 * 60;

/**
 * Builds a signer, or throws. See rule 1 above — an unconfigured process must
 * die at startup, loudly, with a message naming the missing variable and
 * quoting neither of them.
 */
export function createStorageSigner(config: StorageSignerConfig): StorageSigner {
  const base = (config.url ?? "").trim().replace(/\/+$/, "");
  const key = (config.serviceKey ?? "").trim();
  if (base === "") throw new StorageConfigError("storage: SUPABASE_URL is required");
  if (key === "") throw new StorageConfigError("storage: SUPABASE_SERVICE_KEY is required");
  if (!/^https:\/\//i.test(base)) {
    // http would put the minted credential on the wire in clear text
    throw new StorageConfigError("storage: SUPABASE_URL must be https");
  }
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async signDownload(bucket: string, path: string, ttlSeconds: number): Promise<string> {
      if (!bucket || !path) throw new StorageSignError("storage: bucket and path are required");
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new StorageSignError("storage: ttl must be a positive number of seconds");
      }
      if (ttlSeconds > MAX_TTL_SEC) {
        // The point of a signed URL is that it expires while the incident is
        // still small. A caller asking for a week has lost the plot, and
        // silently clamping would hide that from them.
        throw new StorageSignError("storage: ttl exceeds 24h");
      }
      // Each SEGMENT is encoded: a stored path is `org/call/part.ogg`, so the
      // separators must survive while anything odd inside a name does not.
      const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
      if (encodedPath === "") throw new StorageSignError("storage: path is empty");

      let response: Response;
      try {
        response = await doFetch(
          `${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              apikey: key,
              "content-type": "application/json",
            },
            body: JSON.stringify({ expiresIn: Math.floor(ttlSeconds) }),
          },
        );
      } catch {
        // The cause may hold the request (and therefore the key). Status-free
        // and cause-free on purpose.
        throw new StorageSignError("storage: sign request failed");
      }

      // Status only. The body of a FAILED response can still echo the path,
      // and of a successful one holds the credential itself.
      if (!response.ok) throw new StorageSignError(`storage: sign failed (${response.status})`);

      const payload = (await response.json()) as { signedURL?: unknown; signedUrl?: unknown };
      const signed = payload.signedURL ?? payload.signedUrl;
      if (typeof signed !== "string" || signed === "") {
        throw new StorageSignError("storage: sign response had no url");
      }
      // Supabase answers with a project-relative path (`/object/sign/…`);
      // returning it unjoined would hand ml/ something that is not a URL.
      return signed.startsWith("http") ? signed : `${base}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
    },
  };
}

/**
 * Startup helper: reads the environment and applies rule 1. Kept separate so
 * that tests (and any caller with config from elsewhere) never touch the
 * process environment.
 */
export function storageSignerFromEnv(env: NodeJS.ProcessEnv = process.env): StorageSigner {
  return createStorageSigner({
    url: env.SUPABASE_URL ?? "",
    serviceKey: env.SUPABASE_SERVICE_KEY ?? "",
  });
}
