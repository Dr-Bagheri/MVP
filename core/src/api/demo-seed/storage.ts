/**
 * The demo seed's three storage acts (M52): does the pre-generated speech
 * exist, put it there ONCE if it does not, and put a copy of it where this
 * organisation's call will look.
 *
 * A COPY per seed, not an upload. The bytes were synthesised once by
 * core/scripts/demo-audio-build.mjs and live at `_demo/<language>/<record>/
 * part-N.wav`; a seed that re-uploaded them would move ~26 MB per demo
 * organisation across the wire for no reason, and would have to hold the
 * audio in the api process to do it.
 *
 * THE RULE, so no deployment needs a hand-run script: production needs no
 * manual upload. The recordings ship in the repository under
 * core/assets/demo-audio/<language>/<record>.wav (the source of truth);
 * `_demo/` in Storage is a cache. The FIRST seed on a deployment finds the
 * object absent, verifies the bundled file's sha256 against the pack, uploads
 * it with `upload`, and copies; every later seed finds it present and copies.
 * See assets.ts and engine.ts's audio stage.
 *
 * The absence branch is still the point of the module. If the artefact is in
 * neither place, or the bundled bytes do not match the pack's measurement, the
 * seed does NOT fail: it writes the record without audio and SAYS SO in its
 * result (rule 12 — name which nothing). A demo organisation whose transcripts
 * and summaries are all there and whose player is greyed is a demo that can
 * still be given; a seed that refused because a wav was missing is one that
 * cannot. A seed that uploaded the WRONG bytes would be worse than either —
 * a click-to-seek landing on the wrong sentence forever — which is why the
 * hash check stands in front of the upload.
 *
 * This does not use core/src/storage/signer.ts, and the reason is that the
 * signer signs — it mints upload and download URLs and removes objects. It
 * has no copy, and copy is the whole job here. The auth is the same pair of
 * headers on the same base URL.
 */

export interface DemoStorage {
  /** true when the pre-generated artefact is in the bucket */
  has(sourceKey: string): Promise<boolean>;
  /** copy it to the organisation's own path; false when the source is gone */
  copy(sourceKey: string, destinationKey: string): Promise<boolean>;
  /**
   * Put the bundled artefact under its `_demo` key — the cache fill. Upsert,
   * so two seeds racing on a fresh deployment both succeed; a failure throws,
   * because "could not fill the cache" is a fault, not an absence.
   */
  upload(destinationKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface DemoStorageConfig {
  url: string;
  serviceKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
}

export const DEMO_BUCKET = "call-audio";

/** The object path a seeded call's part lives at, matching uploads.ts's shape. */
export const seededPartPath = (callId: string, idx: number): string =>
  `${callId}/demo-part-${idx}.wav`;

export function createDemoStorage(config: DemoStorageConfig): DemoStorage {
  const base = config.url.replace(/\/+$/, "");
  const bucket = config.bucket ?? DEMO_BUCKET;
  const doFetch = config.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${config.serviceKey}`,
    apikey: config.serviceKey,
  };
  const encode = (path: string) =>
    path.split("/").filter(Boolean).map(encodeURIComponent).join("/");

  return {
    async has(sourceKey) {
      const response = await doFetch(
        `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encode(sourceKey)}`,
        { method: "HEAD", headers },
      );
      return response.ok;
    },

    async copy(sourceKey, destinationKey) {
      const response = await doFetch(`${base}/storage/v1/object/copy`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          bucketId: bucket,
          sourceKey,
          destinationKey,
        }),
      });
      if (response.ok) return true;
      /* 400 and 404 are both how this provider spells "there is no such
         object" — the shape 0132's purge learned the hard way, where a
         nested 404 inside a 400 was the real answer. Absence is decided
         HERE, where the spelling is known, and reaches the caller as a
         boolean; anything else is a fault worth raising. */
      if (response.status === 404 || response.status === 400) return false;
      throw new Error(`storage copy failed: HTTP ${response.status}`);
    },

    async upload(destinationKey, bytes, contentType) {
      /* the same request the generator makes: PUT on the object path with
         `x-upsert`, service key, the bytes as the body */
      const response = await doFetch(
        `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encode(destinationKey)}`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": contentType, "x-upsert": "true" },
          /* `new Uint8Array(bytes)`, not `bytes`. Since TypeScript 5.7 the
             typed arrays are generic in their buffer, and everything that
             reaches here — `readFileSync`'s Buffer, most notably — is typed
             `Uint8Array<ArrayBufferLike>`. `ArrayBufferLike` includes
             `SharedArrayBuffer`, which is neither a `BodyInit` nor a
             `BlobPart`, so `body: bytes` fails to typecheck with a "no overload
             matches" that names neither the buffer nor the reason — and it
             fails the WEB build, whose typecheck reads core's sources.

             This constructor's `ArrayLike` overload returns a
             `Uint8Array<ArrayBuffer>`, so the narrowing is done by a real
             operation rather than asserted by a cast. It costs one copy of the
             part — a few megabytes, once per seeded recording, on a path that
             is already doing a network upload.

             Two narrower attempts failed first and are worth not repeating:
             tightening the interface to `Uint8Array<ArrayBuffer>` moved the
             same error up into `engine.ts`, and wrapping in a `Blob` hit it
             again because `BlobPart` demands `ArrayBufferView<ArrayBuffer>`. */
          body: new Uint8Array(bytes),
        },
      );
      if (!response.ok) {
        throw new Error(`storage upload ${destinationKey} failed: HTTP ${response.status}`);
      }
    },
  };
}

/** Configured or not, said once, so a caller can report which nothing. */
export function demoStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DemoStorage | null {
  const url = env.SUPABASE_URL ?? "";
  const serviceKey = env.SUPABASE_SERVICE_KEY ?? "";
  if (url === "" || serviceKey === "") return null;
  return createDemoStorage({ url, serviceKey });
}
