/**
 * Does the multi-row transcript write actually round-trip? (speed pass, 2026-08-29)
 *
 * `writeTranscript` and `upsertSpeakers` used to issue one INSERT per row —
 * 200 segments, 200 round trips. They now send arrays and re-join them with
 * `unnest`. Every unit test of that path runs against a fake pool, and a fake
 * pool answers the same green tick to:
 *
 *   - SQL that Postgres would reject outright,
 *   - an array bound at a type that silently truncates or reorders,
 *   - and `words` double-encoded into jsonb STRINGS, which reads back through
 *     JSON.parse perfectly and answers null to every `->>` in SQL.
 *
 * That last one is not hypothetical: db/src/db/jsonb.ts exists because three
 * modules shipped it on the same day, and `transcript_segment.words` was one
 * of them. Moving that column into an ARRAY parameter is the exact manoeuvre
 * that reintroduces it, so this asks a real database.
 *
 * ── the fixture comes from the database, not from me ────────────────────────
 *
 * Rule 9: a test cannot fail when its fixture is derived from the same belief
 * as the implementation. So the input here is not a hand-written segment list
 * — it is READ BACK from a part the real pipeline already transcribed from
 * real Persian audio, words, ZWNJ, punctuation and all. The assertion is that
 * what comes out equals what went in, where "what went in" was produced by
 * the system rather than by my idea of what a segment looks like. A
 * hand-written fixture would agree with my code about the shape of a word for
 * the same reason I wrote both.
 *
 * ── nothing is left behind ──────────────────────────────────────────────────
 *
 * echo_app holds no DELETE anywhere by design, so this cannot tidy up after
 * itself the usual way. Instead the whole run — the throwaway call, its part,
 * the roster and the segments — happens inside ONE outer transaction that is
 * always rolled back, with a pool shim that hands `withIdentity` that same
 * transaction instead of opening its own. `set_config(…, true)` is
 * transaction-local, so the identity still applies exactly as in production.
 *
 * Not vitest: needs a real connection and writes (then unwrites) rows.
 *
 *   ECHO_APP_DB_URL=… node --experimental-strip-types test/e2e/transcript-write.ts
 */
import postgres from "postgres";

import { upsertSpeakers, writeTranscript } from "../../src/worker/steps.ts";
import { type SqlTx } from "../../src/db/identity.ts";
import type { MappedSegment } from "../../src/worker/transcript-mapping.ts";
import type { PartRow } from "../../src/worker/lifecycle.ts";

const url = process.env.ECHO_APP_DB_URL;
/**
 * The actor is SUPPLIED, and cannot be discovered from inside.
 *
 * The first version of this script tried to find its own subject: read the
 * part with the most segments, take that call's owner, become them. It
 * reported INVALID on the first run, correctly — under `echo_app` with no
 * actor set, every policy denies, so the query that was meant to choose an
 * identity was already running without one. There is no order that fixes it:
 * finding a row requires an identity, and the identity was to come from a row.
 *
 * So the operator names the actor. No default: a wrong-but-plausible constant
 * would make this script report "nothing to round-trip" on a database that has
 * plenty, which is the vacuous pass this file is built to refuse.
 */
const actorId = process.env.ECHO_DEV_ACTOR;
if (!url || !actorId) {
  console.error("ECHO_APP_DB_URL and ECHO_DEV_ACTOR are required (read them from the secret store / catalogue)");
  process.exit(2);
}

const raw = postgres(url, { max: 1 });

let failures = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ok   ${what}`);
  else {
    failures += 1;
    console.error(`  FAIL ${what}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
};

/** Thrown to roll the outer transaction back once every check has run. */
class Done extends Error {}

interface SourceRow {
  seq: number;
  start_ms: number;
  end_ms: number;
  text: string;
  words: { w: string; s: number; e: number; c?: number }[];
}

try {
  await raw.begin(async (outer) => {
    const tx = outer as unknown as SqlTx;
    // The production preamble, in the production spelling.
    await tx.unsafe(
      `select set_config('role', $1, true), set_config('echo.actor_id', $2, true)`,
      ["echo_app", actorId],
    );

    // ── the richest transcript THIS ACTOR can see ──────────────────────────
    // Read under their RLS, deliberately: a part the actor cannot see is not
    // a fixture, it is a different bug.
    const [owner] = await tx.unsafe<{ actor: string; org: string; part: string; call: string; n: number }>(
      `select c.owner_id as actor, c.org_id as org, s.part_id as part, s.call_id as call,
              count(*)::int as n
         from echo.transcript_segment s
         join echo.call c on c.id = s.call_id
        where jsonb_array_length(s.words) > 0
        group by c.owner_id, c.org_id, s.part_id, s.call_id
        order by count(*) desc
        limit 1`,
    );
    if (!owner) {
      // Rule 9 binds live harnesses: "did not run, result unknown" beats a
      // vacuous pass. An empty source is not a green.
      console.error(`  INVALID actor ${actorId.slice(0, 8)} can see no transcribed part — nothing to round-trip`);
      failures += 1;
      throw new Done();
    }
    console.log(`source: part ${owner.part.slice(0, 8)} · ${owner.n} segments · owner ${owner.actor.slice(0, 8)}`);
    check("the fixture is genuinely multi-segment", owner.n > 1, owner.n);

    const source = await tx.unsafe<SourceRow>(
      `select seq, start_ms, end_ms, text, words
         from echo.transcript_segment where part_id = $1 order by seq`,
      [owner.part],
    );

    // ── a throwaway call + part to write into ──────────────────────────────
    const [call] = await tx.unsafe<{ id: string }>(
      // Enum labels read from pg_enum, not guessed: the first draft invented
      // 'recorded' (22P02) because it sounded like the word a call status
      // would use. `call_status` is recording|processing|linking|summarizing|
      // ready|failed.
      `insert into echo.call (org_id, owner_id, title, source, language, status)
       values ($1, $2, 'perf round-trip (rolled back)', 'upload', 'fa', 'processing')
       returning id`,
      [owner.org, owner.actor],
    );
    const [part] = await tx.unsafe<{ id: string }>(
      `insert into echo.call_part (call_id, org_id, idx, offset_ms, storage_bucket, storage_path, status)
       values ($1, $2, 0, 0, 'call-audio', 'perf/roundtrip.wav', 'uploaded')
       returning id`,
      [call!.id, owner.org],
    );

    /*
     * Both functions take the caller's transaction (the per-part batching in
     * steps.ts owns it), so this script hands them the outer one it is about
     * to roll back — no pool shim needed, and the identity is the one set in
     * the preamble above, in the production spelling.
     */
    const partRow = {
      id: part!.id, call_id: call!.id, idx: 0, offset_ms: 0, duration_ms: null,
      storage_bucket: "call-audio", storage_path: "perf/roundtrip.wav",
      audio_sha256: null, status: "uploaded", missing: false, call_language: "fa",
    } as unknown as PartRow;

    // Rebuild the mapper's shape from the rows the pipeline wrote. The stored
    // spelling is {w,s,e,c}; MappedSegment's is {w,startMs,endMs,confidence}.
    const segments: MappedSegment[] = source.map((row, i) => ({
      partId: part!.id,
      seq: row.seq,
      startMs: row.start_ms,
      endMs: row.end_ms,
      text: row.text,
      // Two speakers, alternating, so the roster join is exercised in both
      // directions rather than every segment landing on one id.
      speaker: i % 2 === 0 ? "S1" : "S2",
      words: (row.words ?? []).map((w) => ({
        w: w.w, startMs: w.s, endMs: w.e,
        ...(w.c !== undefined ? { confidence: w.c } : {}),
      })),
    }));

    // ── the code under test ────────────────────────────────────────────────
    const speakerIds = await upsertSpeakers(tx, owner.org, partRow, segments, {
      provenance: { diarization: { source: "cluster" } },
      words: [],
    });
    check("the roster came back with both labels", speakerIds.size === 2, [...speakerIds.keys()]);

    await writeTranscript(tx, owner.org, partRow, segments, {
      provenance: { ml_version: "roundtrip", stt: { lane: "test", timestamps: "word" } },
      degraded: false,
      words: [],
    }, speakerIds);

    // ── did it land, and is it the same? ───────────────────────────────────
    const written = await tx.unsafe<SourceRow & { call_speaker_id: string | null; provenance: unknown }>(
      `select seq, start_ms, end_ms, text, words, call_speaker_id, provenance
         from echo.transcript_segment where part_id = $1 order by seq`,
      [part!.id],
    );

    check("every segment was written", written.length === source.length,
      { wrote: written.length, expected: source.length });

    // Row-for-row equality, not a spot check: a multi-row insert can drop,
    // duplicate or mis-pair rows in ways a sample of one never shows.
    const mismatched = written.filter((row, i) => {
      const src = source[i];
      return !src
        || row.seq !== src.seq
        || row.start_ms !== src.start_ms
        || row.end_ms !== src.end_ms
        || row.text !== src.text;
    });
    check("every row matches its source, in order", mismatched.length === 0,
      mismatched.slice(0, 2).map((r) => r.seq));

    check("the Persian survived byte for byte",
      written.map((r) => r.text).join("\0") === source.map((r) => r.text).join("\0"));

    // THE words question, asked in SQL — the shape a JS-side JSON.parse
    // cannot distinguish from the broken one.
    const kinds = await tx.unsafe<{ kind: string }>(
      `select distinct jsonb_typeof(w) as kind
         from echo.transcript_segment s, jsonb_array_elements(s.words) w
        where s.part_id = $1`,
      [part!.id],
    );
    check("every word is an OBJECT, never a jsonb string",
      kinds.length === 1 && kinds[0]?.kind === "object", kinds.map((k) => k.kind));

    const [reach] = await tx.unsafe<{ n: number }>(
      `select count(*)::int as n
         from echo.transcript_segment s, jsonb_array_elements(s.words) w
        where s.part_id = $1 and w->>'w' is not null and (w->>'s') ~ '^[0-9]+$'`,
      [part!.id],
    );
    const expectedWords = segments.reduce((n, s) => n + s.words.length, 0);
    check("SQL can read every word and its start", Number(reach?.n) === expectedWords,
      { reachable: reach?.n, expected: expectedWords });

    check("words is an ARRAY at the column level too",
      (await tx.unsafe<{ bad: number }>(
        `select count(*)::int as bad from echo.transcript_segment
          where part_id = $1 and jsonb_typeof(words) <> 'array'`, [part!.id],
      ))[0]?.bad === 0);

    check("provenance is a queryable object, not a quoted blob",
      (await tx.unsafe<{ v: string | null }>(
        `select provenance->>'ml_version' as v from echo.transcript_segment
          where part_id = $1 limit 1`, [part!.id],
      ))[0]?.v === "roundtrip");

    // Both speakers really are on the rows — the multi-row roster mapping is
    // by NAME now, and a positional pairing would put one voice's id on the
    // other's words without changing any count.
    const attribution = await tx.unsafe<{ label: string; n: number }>(
      `select sp.label, count(*)::int as n
         from echo.transcript_segment s
         join echo.call_speaker sp on sp.id = s.call_speaker_id
        where s.part_id = $1 group by sp.label order by sp.label`,
      [part!.id],
    );
    check("both voices are attributed, and to their own segments",
      attribution.length === 2
        && attribution.every((a) => a.n > 0)
        && attribution[0]?.label === "S1·1" && attribution[1]?.label === "S2·1",
      attribution);

    const evens = source.filter((_, i) => i % 2 === 0).map((r) => r.seq).sort((a, b) => a - b);
    const s1 = (await tx.unsafe<{ seq: number }>(
      `select s.seq from echo.transcript_segment s
         join echo.call_speaker sp on sp.id = s.call_speaker_id
        where s.part_id = $1 and sp.label = 'S1·1' order by s.seq`, [part!.id],
    )).map((r) => r.seq);
    check("S1's segments are exactly the ones sent as S1",
      s1.length === evens.length && s1.every((v, i) => v === evens[i]),
      { got: s1.slice(0, 3), expected: evens.slice(0, 3) });

    throw new Done();
  });
} catch (error) {
  if (!(error instanceof Done)) throw error;
} finally {
  await raw.end();
}

console.log(
  failures === 0
    ? "\ntranscript write round-trip: OK (everything rolled back)"
    : `\ntranscript write round-trip: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
