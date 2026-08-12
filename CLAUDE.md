# Echo Platform (repo: MVP) — session guide

The commercial rebuild: calls/meetings → transcripts → versioned summaries →
an org-scoped AI agent, built to be **sold** — completeness and correctness
over speed. TypeScript everywhere. Persian-first UI.

## Sources of truth

1. **[docs/SPEC.md](docs/SPEC.md)** — WHAT the product does. Product behavior
   conflicts resolve here.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — HOW it's built; decisions numbered
   M1…; currently **DRAFT — decisions are NOT locked until the user's review
   rounds finish**. Do not build against draft sections marked §OPEN.

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

- 2026-08-10: Folder created; private repo requested; SPEC.md captured from
  the founding spec; ARCHITECTURE.md DRAFT 1 written (M1–M14 + §OPEN).
  In review with the user — multiple rounds expected before build dispatch.
