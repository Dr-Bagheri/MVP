// Trimming silence saves money and breaks time. This puts time back.
//
// After VAD we hand the STT a file made of the speech regions concatenated
// together, so every timestamp it returns is on that shortened timeline. The
// contract's first guarantee is that callers see the ORIGINAL timeline, so
// every timestamp is mapped back through here before it leaves ml/.

import type { Segment } from "./schema.js";

export class TimelineMap {
  private readonly starts: number[] = [];
  private readonly cumulative: number[] = [];
  readonly speechMs: number;

  constructor(private readonly regions: readonly Segment[]) {
    let acc = 0;
    for (const r of regions) {
      this.starts.push(r.start_ms);
      this.cumulative.push(acc);
      acc += r.end_ms - r.start_ms;
    }
    this.speechMs = acc;
  }

  /** Identity map — used when VAD is off and no trimming happened. */
  static identity(durationMs: number): TimelineMap {
    return new TimelineMap([{ start_ms: 0, end_ms: durationMs }]);
  }

  toOriginal(trimmedMs: number): number {
    if (this.regions.length === 0) return trimmedMs;
    if (trimmedMs <= 0) return this.starts[0] ?? 0;

    // Last region whose cumulative offset is at or before the point.
    let idx = 0;
    for (let i = 0; i < this.cumulative.length; i++) {
      if ((this.cumulative[i] ?? 0) <= trimmedMs) idx = i;
      else break;
    }

    const region = this.regions[idx]!;
    const within = trimmedMs - (this.cumulative[idx] ?? 0);
    // Clamp inside the region: a timestamp past the end of the last region
    // means the STT ran slightly long, not that speech happened in silence.
    return Math.min(region.end_ms, region.start_ms + within);
  }
}
