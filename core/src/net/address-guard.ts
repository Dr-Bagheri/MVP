/**
 * Where the product is allowed to be made to connect (steward finding, M17).
 *
 * A webhook URL is chosen by an org admin and fetched by US, from inside the
 * deployment network. `https://` only does not close that: `https://10.0.0.5/`
 * is a perfectly valid https URL.
 *
 * The sharper half of the finding, which is what makes this required rather
 * than tidy: `webhook_delivery.response_code` is stored and admin-readable.
 * So a delivery is not merely an outbound request — it is a **port-scan
 * oracle**. Register a webhook at an internal address, read back the status
 * code, repeat. Identifiers-only payloads limit what leaks OUT; they say
 * nothing about where we can be induced to connect, or what the response
 * tells the person who induced it.
 *
 * ── Why the check lives at CONNECT time ─────────────────────────────────────
 *
 * Validating the URL when it is registered is worth doing (a legible refusal
 * beats a mysterious failed delivery) but it is NOT the control. DNS rebinding
 * defeats it completely: `evil.test` resolves public at registration, private
 * at delivery, and a parse-time check has long since passed.
 *
 * So `guardedLookup` is a DNS lookup that refuses blocked addresses, handed to
 * the HTTP agent. It runs as the socket is being opened, on the address
 * actually being connected to — the only moment where the answer cannot go
 * stale between the check and the connection.
 *
 * Redirects are the same hole one hop along: the dispatcher MUST follow them
 * manually and re-check each hop, because a public URL that 302s to
 * `http://169.254.169.254/` is the classic metadata-service fetch.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

export class BlockedAddressError extends Error {}

/**
 * Ranges we refuse to be pointed at.
 *
 * `169.254.169.254` is called out because it is the cloud metadata service on
 * AWS/GCP/Azure — the single highest-value SSRF target in existence, and it
 * answers to unauthenticated GETs with credentials. It falls inside
 * link-local anyway; naming it is for whoever reads this list later.
 */
function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;   // unparseable is not "fine"
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;                      // 0.0.0.0/8 "this network"
  if (a === 10) return true;                     // private
  if (a === 127) return true;                    // loopback
  if (a === 169 && b === 254) return true;       // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;       // private
  if (a === 192 && b === 0) return true;         // 192.0.0.0/24 IETF protocol
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true;                     // multicast + reserved + broadcast
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const ip = address.toLowerCase().split("%")[0] ?? "";
  if (ip === "::" || ip === "::1") return true;          // unspecified, loopback
  if (ip.startsWith("fe80") || ip.startsWith("fe9")
    || ip.startsWith("fea") || ip.startsWith("feb")) return true;   // link-local
  if (/^f[cd]/.test(ip)) return true;                    // unique-local fc00::/7
  if (ip.startsWith("ff")) return true;                  // multicast
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible: judge the v4 part, or
  // every v4 rule above is bypassed by writing the address differently.
  const mapped = /(?:^::ffff:|^::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);
  return false;
}

/** Is this literal IP one we refuse to connect to? */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;   // not an IP at all — nothing here should be guessing
}

/**
 * Registration-time check: scheme, shape, and a literal address if one was
 * given. Cheap, and it turns "my webhook silently never fires" into a 400 at
 * the moment the admin can fix it.
 *
 * NOT a substitute for the connect-time check — a hostname is not resolved
 * here, deliberately: doing so would imply a guarantee that DNS can revoke a
 * millisecond later.
 */
export function assertDeliverableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError("not a valid url");
  }
  if (url.protocol !== "https:") throw new BlockedAddressError("url must be https");
  // Credentials in a webhook URL end up in logs and in the admin UI, and they
  // are a common way to smuggle a different host past a naive parser.
  if (url.username !== "" || url.password !== "") {
    throw new BlockedAddressError("url must not contain credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new BlockedAddressError("url points at a private or reserved address");
  }
  return url;
}

/**
 * A `dns.lookup` that refuses blocked addresses, for the delivery agent.
 *
 * This is THE control: it is invoked while the socket is being opened, so the
 * address it approves is the address actually connected to. A rebinding attack
 * has nothing left to swap.
 *
 * Signature matches Node's `LookupFunction` so it can be passed straight to an
 * http(s) Agent or undici's `connect` options.
 */
export function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...(options as object), all: true }, (error, addresses) => {
    if (error) return callback(error);
    const resolved = addresses as { address: string; family: number }[];
    const blocked = resolved.find((entry) => isBlockedAddress(entry.address));
    if (blocked) {
      // The hostname is deliberately NOT echoed back into the delivery record
      // beyond what the admin already knows — but the refusal must be loud
      // enough to diagnose, so the address is named.
      return callback(Object.assign(
        new Error(`refusing to connect to blocked address ${blocked.address}`),
        { code: "EBLOCKED" },
      ));
    }
    if (resolved.length === 0) {
      return callback(Object.assign(new Error("hostname did not resolve"), { code: "ENOTFOUND" }));
    }
    callback(null, resolved, resolved[0]!.family);
  });
}

/**
 * The delivery contract, stated here because the dispatcher does not exist
 * yet and this requirement must not arrive as a patch afterwards:
 *
 *   1. Build the request with an agent using `guardedLookup`.
 *   2. `redirect: "manual"`. On a 3xx, run `assertDeliverableUrl` on the
 *      Location, then repeat from (1) — a public URL that 302s to
 *      `http://169.254.169.254/` is the classic metadata fetch.
 *   3. Cap the hops (3 is plenty for a webhook) and treat exhaustion as a
 *      failed delivery, not a retry loop.
 *   4. A blocked address is NOT retryable: it will be blocked again, and
 *      retrying turns one refusal into a slow scan.
 */
export const MAX_DELIVERY_REDIRECTS = 3;
