"use client";

/**
 * The crash-proof take buffer (user directive, 2026-08-22): while the
 * recorder rolls, every ~1s audio chunk is ALSO written to IndexedDB, so a
 * crashed tab, a killed browser or a dead battery loses at most the last
 * second — not the take. The buffer is a copy, never the source: the live
 * upload path is unchanged, and a part's buffered chunks are dropped the
 * moment that part's upload REGISTERS (the server copy is then the record).
 * Whatever is left in the buffer on the next visit is exactly what never
 * reached the server — the recovery card offers to upload it, download it,
 * or discard it.
 *
 * Storage shape: one `parts` store keyed [callId, partIdx] holding the
 * part's metadata, and one `chunks` store keyed auto with a [callId,
 * partIdx] index holding the blobs in arrival order. Two stores because the
 * hot path (append one chunk) must not rewrite the part's accumulated
 * bytes each second.
 *
 * Everything IndexedDB is best-effort by design: a browser without it (or a
 * full quota) records exactly as before — the buffer failing must never
 * block or fail a take (M21: the copy is INFERRED work; the take is what
 * was TOLD).
 */

const DB_NAME = "neurai-take-buffer";
const DB_VERSION = 1;

export interface BufferedPartMeta {
  callId: string;
  partIdx: number;
  offsetMs: number;
  mime: string;
  title: string;
  updatedAt: number;
}

export interface BufferedPart extends BufferedPartMeta {
  bytes: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("parts")) {
        db.createObjectStore("parts", { keyPath: ["callId", "partIdx"] });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const chunks = db.createObjectStore("chunks", { autoIncrement: true });
        chunks.createIndex("byPart", ["callId", "partIdx"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Record (or refresh) a part's metadata — called when the part starts. */
export async function markPart(meta: Omit<BufferedPartMeta, "updatedAt">): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(["parts"], "readwrite");
    tx.objectStore("parts").put({ ...meta, updatedAt: Date.now() } satisfies BufferedPartMeta);
    await done(tx);
  } catch { /* best-effort */ } finally { db.close(); }
}

/** Append one chunk to a part's buffer. Fire-and-forget from the hot path. */
export async function bufferChunk(callId: string, partIdx: number, chunk: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(["chunks"], "readwrite");
    tx.objectStore("chunks").add({ callId, partIdx, chunk });
    await done(tx);
  } catch { /* best-effort */ } finally { db.close(); }
}

/** Drop ONE part's buffer — its upload registered; the server copy is the record. */
export async function clearPart(callId: string, partIdx: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(["parts", "chunks"], "readwrite");
    tx.objectStore("parts").delete([callId, partIdx]);
    const index = tx.objectStore("chunks").index("byPart");
    const range = IDBKeyRange.only([callId, partIdx]);
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    await done(tx);
  } catch { /* best-effort */ } finally { db.close(); }
}

/** Drop EVERYTHING buffered for a call — the take finished clean or was discarded. */
export async function clearTake(callId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const parts = await listLeftovers();
    for (const p of parts.filter((p) => p.callId === callId)) {
      await clearPart(callId, p.partIdx);
    }
  } catch { /* best-effort */ } finally { db.close(); }
}

/** Every buffered part on this device, with its byte size — the recovery list. */
export async function listLeftovers(): Promise<BufferedPart[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(["parts", "chunks"], "readonly");
    const metas = await new Promise<BufferedPartMeta[]>((resolve) => {
      const req = tx.objectStore("parts").getAll();
      req.onsuccess = () => resolve((req.result as BufferedPartMeta[]) ?? []);
      req.onerror = () => resolve([]);
    });
    const out: BufferedPart[] = [];
    for (const meta of metas) {
      const bytes = await new Promise<number>((resolve) => {
        const req = tx
          .objectStore("chunks")
          .index("byPart")
          .getAll(IDBKeyRange.only([meta.callId, meta.partIdx]));
        req.onsuccess = () => {
          const rows = (req.result as { chunk: Blob }[]) ?? [];
          resolve(rows.reduce((sum, r) => sum + r.chunk.size, 0));
        };
        req.onerror = () => resolve(0);
      });
      out.push({ ...meta, bytes });
    }
    await done(tx);
    return out;
  } catch {
    return [];
  } finally { db.close(); }
}

/** Rebuild one part's audio from its buffered chunks, in arrival order. */
export async function readPartBlob(callId: string, partIdx: number, mime: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(["chunks"], "readonly");
    const rows = await new Promise<{ chunk: Blob }[]>((resolve) => {
      const req = tx
        .objectStore("chunks")
        .index("byPart")
        .getAll(IDBKeyRange.only([callId, partIdx]));
      req.onsuccess = () => resolve((req.result as { chunk: Blob }[]) ?? []);
      req.onerror = () => resolve([]);
    });
    await done(tx);
    if (rows.length === 0) return null;
    return new Blob(rows.map((r) => r.chunk), { type: mime });
  } catch {
    return null;
  } finally { db.close(); }
}

/**
 * The recovery PLAN — pure, so the ordering rule is testable without a
 * browser: parts group by call and upload in idx order (the uploader's
 * honest-prefix rule holds for recovered audio too), calls order by most
 * recent activity. Empty parts are dropped here — a zero-byte buffer is a
 * part that never got a chunk, and "recovering" it would register silence.
 */
export function recoveryPlan(parts: readonly BufferedPart[]): {
  callId: string;
  title: string;
  updatedAt: number;
  parts: BufferedPart[];
}[] {
  const byCall = new Map<string, BufferedPart[]>();
  for (const part of parts) {
    if (part.bytes <= 0) continue;
    const list = byCall.get(part.callId) ?? [];
    list.push(part);
    byCall.set(part.callId, list);
  }
  return [...byCall.entries()]
    .map(([callId, list]) => {
      const sorted = [...list].sort((a, b) => a.partIdx - b.partIdx);
      return {
        callId,
        title: sorted[sorted.length - 1]!.title,
        updatedAt: Math.max(...sorted.map((p) => p.updatedAt)),
        parts: sorted,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
