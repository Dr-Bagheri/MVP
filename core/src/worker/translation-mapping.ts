/**
 * Translation units → the record's LINES (2026-09-06, C4).
 *
 * ml/ answers a translation as units on the part's own 0-based timeline: an
 * original run with its span and the translation that followed it. The
 * product stores lines (transcript_segment) on the CALL timeline, and a
 * reader wants each line's translation beside it — so every unit is placed
 * on the line whose span holds the unit's midpoint, with two fallbacks that
 * keep a unit from vanishing: the line it overlaps most, then the nearest
 * line. A unit is never dropped; a line with no unit gets no entry, which
 * the screen shows as nothing rather than as an invented sentence.
 *
 * Pure, and tested on the edges (a unit astride two lines, a unit in a gap,
 * units out of order), because this is where a translation would silently
 * land one line off.
 */
export interface TranslationUnit {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface SegmentSpan {
  id: string;
  start_ms: number;
  end_ms: number;
}

export function assignUnitsToSegments(
  units: readonly TranslationUnit[],
  segments: readonly SegmentSpan[],
  offsetMs: number,
): Map<string, string> {
  const out = new Map<string, string[]>();
  if (segments.length === 0) return new Map();
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);

  for (const unit of units) {
    const text = unit.text.trim();
    if (text === "") continue;
    const start = offsetMs + unit.start_ms;
    const end = offsetMs + Math.max(unit.end_ms, unit.start_ms);
    const mid = (start + end) / 2;

    let target = sorted.find((s) => mid >= s.start_ms && mid < s.end_ms) ?? null;
    if (!target) {
      let bestOverlap = 0;
      for (const s of sorted) {
        const overlap = Math.min(end, s.end_ms) - Math.max(start, s.start_ms);
        if (overlap > bestOverlap) { bestOverlap = overlap; target = s; }
      }
    }
    if (!target) {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const s of sorted) {
        const distance = start < s.start_ms ? s.start_ms - start : start - s.end_ms;
        if (distance < bestDistance) { bestDistance = distance; target = s; }
      }
    }
    if (!target) continue;
    const list = out.get(target.id) ?? [];
    list.push(text);
    out.set(target.id, list);
  }

  return new Map([...out.entries()].map(([id, parts]) => [id, parts.join(" ")]));
}
