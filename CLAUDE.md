# Echo Platform (repo: MVP) — session guide

The commercial rebuild: calls/meetings → transcripts → versioned summaries →
an org-scoped AI agent, built to be **sold** — completeness and correctness
over speed. TypeScript everywhere. Persian-first UI.

**Naming convention (user-set, use everywhere):** plain **Echo** always means
THIS platform; the Android recorder app (Desktop/Neurai-Echo repo) is always
called **Echo Mobile** — in conversation, docs, commits, and UI copy.

## Sources of truth

1. **[docs/SPEC.md](docs/SPEC.md)** — WHAT the product does. Product behavior
   conflicts resolve here.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — HOW it's built; decisions M1–M18,
   **LOCKED (user, 2026-08-12)** — binding on every session. Deviations go to
   the steward first and are amended in the document BEFORE code.

## Rules for every session

1. Do not contradict SPEC.md or locked M-decisions. Deviations go to the
   steward session first; amendments are marked and logged.
2. New constraining choices get numbered M-decisions before or with the code.
3. **Security invariants are non-negotiable**: no DB access without a user
   identity; the agent borrows the caller's authority and never more; RLS +
   role grants are the wall (prompts are never the wall); the agent's DB role
   has no DELETE; `ml/` stays productless; secrets never in the repo; content
   never in logs.
4. Persian-first: RTL, normalization at ingest and query, Persian digits,
   Jalali-capable dates.
5. Schema is hand-written SQL with numbered migrations; Drizzle for queries
   only. RLS/grant changes ship with their SQL tests.
6. The transcript is the source of truth; derived artifacts are rebuildable
   and carry provenance.

## Workflow

Parallel Claude sessions: **steward** (architecture, coordination, verification,
release gate — this file's author), **backend** (core/, ml/, schema), **frontend**
(web/, design via ui-ux-pro-max skill), **docs**, and the **publisher** — the only
session that touches GitHub. Repo: **github.com/Dr-Bagheri/MVP — PRIVATE**.

- No `git commit` / `git push` from build sessions; the publisher reviews and
  pushes. Local tree: `C:\Users\amirreza\Desktop\mvp`.
- `*.docx`, `docs/*.pdf`, `.env*`, keys and keystores never reach the repo.
- Reference codebases (read-only, do not modify): `Desktop\neurai-mvp`
  (on-prem predecessor), `Desktop\Neurai-Echo` (cloud recorder — the pgmq-style
  worker, RLS wall, harness lanes, and near-miss hygiene lessons live there).

## Status

- 2026-08-10: Folder created; private repo live (Dr-Bagheri/MVP); SPEC.md
  captured; ARCHITECTURE.md through DRAFT 2 + rounds 2-3 folded (M1–M18,
  §OPEN empty).
- 2026-08-10 (build start, user-directed): **parallel build begins on
  ruling-stable parts before formal lock** — web/ dispatched (scaffold +
  design system + screens on typed mocks); backend session on the Phase-0
  spike (its findings settle the one open ruling: ml/ language, M1/M9).
  Remaining backend packages (schema+RLS, core/api, core/worker, ml/,
  gateway) split across sessions as they free up; user opens additional
  sessions in this folder when more parallelism is wanted — this file
  onboards them, steward assigns packages.
- 2026-08-12: **ARCHITECTURE LOCKED by the user** (v1.0, M1–M18) after three
  review rounds + the measured Phase-0 spike. Build tracks running: web/
  (Front-end), core/ (Backend), ml/ (Backend 2), schema+RLS (Backend 3).
  Dev Supabase live (aqgpxnyuxukwgphrxslw; keys in DPAPI store under
  echo_platform_*). Soniox funded; quality numbers land post-lock.
