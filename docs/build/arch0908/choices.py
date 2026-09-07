# -*- coding: utf-8 -*-
"""
THE COMPONENT LEDGER — every part the platform is built from, why it was
taken, and three credible alternatives with the trade-off each would impose.

Every row here was checked against the tree on 2026-09-08: package manifests
for versions, /etc/neurai/*.env and systemd for what actually runs, the live
/health payloads for the model files, and the database catalogue for the
extensions. A component nobody installed is not in this table, and a
"competitor" is a thing that could genuinely stand in the same slot — not a
neighbouring category.

Shape: (name, layer, role, why, [(alternative, trade-off) x3])
"""

CHOICES = [
    # ── language and workspace ──────────────────────────────────────────
    (
        "TypeScript 5.7 on Node 22",
        "Language & runtime",
        "One language for the web app, the API, the worker and the speech service.",
        "Wire contracts, vocabulary and domain rules are written once and imported by "
        "every package, so a shape cannot drift between the side that writes it and the "
        "side that reads it. Node also carries the two ecosystems this product needs in "
        "the same process — a web framework and ONNX inference bindings.",
        [
            ("Python", "The richest speech/ML ecosystem, and the obvious choice for the "
                       "ml/ service alone — but it makes the product bilingual at the "
                       "code level and puts a translation boundary on every shared type."),
            ("Go", "Excellent for long-lived services and a single deployable binary; it "
                   "would mean rewriting the shared domain layer and giving up the "
                   "React/Next ecosystem the interface is built on."),
            ("Java / Kotlin (Spring)", "Strongest option for large enterprise teams and "
                                       "tooling; heavier runtime, slower iteration, and no "
                                       "shared code with a TypeScript front end."),
        ],
    ),
    (
        "pnpm workspaces (monorepo)",
        "Language & runtime",
        "Four packages (web, core, ml, db) in one repository, one lockfile.",
        "One commit can change a database migration, the API that reads it and the screen "
        "that shows it — and the tests for all three run together. pnpm's content-addressed "
        "store keeps four Node packages from costing four copies of every dependency.",
        [
            ("npm workspaces", "Zero extra tooling, ships with Node; slower installs and a "
                               "flat node_modules that hides undeclared dependencies."),
            ("Yarn (Berry) + PnP", "Strict resolution and fast installs; the PnP loader "
                                   "still trips native modules such as the ONNX bindings."),
            ("Nx or Turborepo", "Adds task graphs and remote caching, which a four-package "
                                "repository does not need yet; another build system to own."),
        ],
    ),

    # ── the web tier ────────────────────────────────────────────────────
    (
        "Next.js 16 (App Router)",
        "Web",
        "The interface, the route tree, and the BFF that holds the session.",
        "The product needs server-side session handling that never lets a provider token "
        "reach the browser (M1). App Router gives that in the same project as the UI: 179 "
        "server route files proxy the platform API under a cookie the browser cannot read. "
        "Streaming server rendering also carries the assistant's token stream.",
        [
            ("Remix / React Router 7", "Very close in capability and a cleaner data-loading "
                                       "story; smaller ecosystem for RSC-style streaming and "
                                       "a migration of every route."),
            ("Nuxt 4 (Vue)", "Equally complete full-stack framework; would replace the whole "
                             "component layer and the Radix/RTL work with it."),
            ("SvelteKit", "Smallest runtime and the fastest interface of the three; the "
                          "smallest ecosystem for the accessible primitives and the LiveKit "
                          "components this product leans on."),
        ],
    ),
    (
        "React 19",
        "Web",
        "The component model behind 442 source files of interface.",
        "It is what the meeting room, the recorder, the assistant stream and the drag-and-drop "
        "board are all written against, and it has first-party components from LiveKit and "
        "Radix. Concurrent rendering matters here: a live transcript and a token stream "
        "update the same screen while somebody is typing into it.",
        [
            ("Vue 3", "Comparable maturity, gentler learning curve, excellent RTL support; "
                      "a different component ecosystem and a full rewrite."),
            ("Svelte 5", "Less runtime, less code per component, very fast; fewer ready "
                         "accessible primitives, which is where this product spends its risk."),
            ("Angular 20", "Batteries-included structure suits large teams; heavier and far "
                           "more prescriptive than this codebase's own scaffold."),
        ],
    ),
    (
        "Tailwind CSS 3 + CSS variables",
        "Web",
        "The theme: colour, spacing, radius, type scale, light and dark.",
        "Every visual rule is a token in one file, so the platform's look is changed by "
        "editing the scale rather than by touching screens — the 2026-09-02 unification pass "
        "moved the entire product's density from the token table. Contrast pairs are then "
        "verified by a script that fails the build, which is only possible because the "
        "values are data.",
        [
            ("CSS Modules", "Real isolation and no utility vocabulary to learn; every "
                            "screen re-implements spacing and colour by hand."),
            ("Emotion / styled-components", "Dynamic styling in the component; a runtime "
                                            "cost on every render and a second source of truth "
                                            "for theming."),
            ("Panda CSS / vanilla-extract", "Type-safe tokens compiled at build time — the "
                                            "closest competitor; younger, and would re-do work "
                                            "that already passes its own contrast checks."),
        ],
    ),
    (
        "Radix UI primitives + owned shadcn components",
        "Web",
        "Dialogs, menus, popovers, focus management, keyboard behaviour.",
        "shadcn copies SOURCE into the repository instead of installing a dependency, so the "
        "components can carry this product's own rules (RTL direction, Persian digits, the "
        "44px hit area) while Radix keeps the parts that are genuinely hard: focus traps, "
        "dismissable layers, and menus that work inside a modal.",
        [
            ("MUI (Material UI)", "The largest ready component set; a strong opinion about "
                                  "how things should look that this design system would spend "
                                  "its life overriding."),
            ("Mantine", "Rich components and hooks with good defaults; owns its styling "
                        "system, which would sit beside the token layer rather than inside it."),
            ("Headless UI / Ark UI", "The same headless philosophy; smaller primitive "
                                     "coverage — no equivalent of the dismissable-layer "
                                     "handling this product needed seven times."),
        ],
    ),
    (
        "next-intl",
        "Web",
        "Persian and English catalogues, locale-aware routes, message formatting.",
        "The product is Persian-first with an English mirror, and the locale is part of the "
        "URL. next-intl was built for App Router, so the locale is resolved on the server "
        "before the first byte — no flash of the wrong language, and every key that is "
        "missing in either catalogue fails a test rather than rendering a raw key.",
        [
            ("react-i18next", "The most widely used option with the biggest plugin set; its "
                              "App Router integration is a community concern rather than a "
                              "first-class one."),
            ("FormatJS / react-intl", "The reference ICU implementation; more ceremony per "
                                      "message and a build step for extraction."),
            ("Lingui", "Excellent compile-time extraction and small runtime; smaller "
                       "community and another macro-based build step."),
        ],
    ),
    (
        "Vazirmatn (UI) and Lalezar (display)",
        "Web",
        "Persian typography for the interface and the public site.",
        "A Persian-first product lives or dies on its Persian face: Vazirmatn is open, "
        "actively maintained, carries the full range of weights the type scale needs, and "
        "renders ZWNJ and Persian digits correctly at small sizes.",
        [
            ("IRANSans / IRANYekan", "The most familiar faces in Iranian software; licensing "
                                     "is restrictive for a commercial product."),
            ("Estedad", "Modern, open, close in character; a smaller weight range and less "
                        "battle-testing at UI sizes."),
            ("Noto Sans Arabic", "Universal coverage and Google-maintained; drawn for Arabic "
                                 "first, so Persian letterforms read as slightly foreign."),
        ],
    ),
    (
        "LiveKit (rooms, tracks, egress)",
        "Web / Media",
        "The in-product meeting room: audio and video, and per-track recording.",
        "The room is OURS — themed, RTL, inside the meeting page — because LiveKit ships "
        "React components rather than an iframe, and the server mints a scoped token per "
        "participant. It also gives each speaker their own track, which is what makes a "
        "clean recording (and clean speaker separation) possible.",
        [
            ("Jitsi / Jibri", "Free and self-hostable — the direction this product started "
                              "in; the iframe UI could not be themed and moderation on a "
                              "public instance was not acceptable."),
            ("Daily", "Hosted SDK with a very similar model and good React support; another "
                      "vendor contract for the same capability."),
            ("Twilio Video / 100ms", "Mature managed platforms; heavier pricing and no "
                                     "advantage over LiveKit for a room this product already "
                                     "renders itself."),
        ],
    ),

    # ── the core service ────────────────────────────────────────────────
    (
        "Fastify 5",
        "Core API",
        "The HTTP surface: 244 routes on one typed server, plus the ml service.",
        "A small, fast, schema-first framework whose plugin model matches how this API is "
        "assembled (identity, then role, then repository) without imposing an application "
        "architecture. Its lifecycle hooks are where the actor is bound to the transaction, "
        "which is the whole security model in one place.",
        [
            ("Express 5", "The default and the most familiar; slower, and every convention "
                          "(validation, logging, lifecycle) has to be assembled by hand."),
            ("NestJS", "Real application structure and DI for large teams; a heavy "
                       "abstraction over a service whose complexity lives in SQL, not in "
                       "object graphs."),
            ("Hono", "Smaller and edge-portable with excellent TypeScript ergonomics; a "
                     "thinner plugin ecosystem for the Node-side concerns used here."),
        ],
    ),
    (
        "postgres.js with hand-written SQL (no ORM)",
        "Core API",
        "Every query, parameterised, inside an identity-bound transaction.",
        "The security boundary of this product is written in SQL — row-level policies, role "
        "grants, composite foreign keys, definer functions — and an ORM's job is to hide "
        "SQL. Keeping the statements visible is what lets a reviewer see the wall. "
        "postgres.js adds tagged-template parameterisation and honest connection handling "
        "and nothing else.",
        [
            ("Drizzle", "The closest thing to typed SQL without hiding it; would still add a "
                        "schema definition beside the migrations that are already the truth."),
            ("Prisma", "The best developer experience of the three and strong migrations; its "
                       "model layer fights row-level security and per-transaction actors."),
            ("Kysely", "A pure typed query builder with no runtime model; genuinely viable — "
                       "it buys type-checked queries at the cost of a second dialect to read."),
        ],
    ),
    (
        "Zod",
        "Core API",
        "Runtime validation at every boundary: request bodies, tool arguments, provider replies.",
        "TypeScript disappears at runtime, and three of this system's inputs are outside its "
        "control — people, providers and language models. Zod schemas are the same objects "
        "the agent tools publish as their argument contracts, so a tool cannot accept "
        "something its schema does not describe.",
        [
            ("Ajv (JSON Schema)", "The standard format, and directly usable as an LLM tool "
                                  "schema; schema authoring is far more verbose."),
            ("Valibot", "Same idea, much smaller bundle; younger, with fewer integrations."),
            ("TypeBox", "JSON Schema and TypeScript types from one definition — a strong fit "
                        "for Fastify; a migration with no functional gain today."),
        ],
    ),
    (
        "Pino",
        "Core API",
        "Structured logs from the API, the worker and the speech service.",
        "Logs here must carry codes and identifiers and never content — no transcript line, "
        "no message body, not even a Postgres error detail (it quotes the offending row). "
        "Pino's serialisers make that redaction a configuration rather than a discipline, "
        "and it is fast enough to leave on in production.",
        [
            ("Winston", "More transports and formats out of the box; slower and heavier for "
                        "the same job."),
            ("Bunyan", "The original structured JSON logger; effectively unmaintained."),
            ("OpenTelemetry logs", "Vendor-portable and correlated with traces; needs a "
                                   "collector and a storage decision this deployment has not "
                                   "made yet."),
        ],
    ),
    (
        "Pi agent core / Pi AI (@earendil-works)",
        "Agents",
        "The model loop: streaming, tool dispatch, provider abstraction.",
        "The loop is embedded as a library rather than run as a service, so the product keeps "
        "the parts that matter — which tools exist, whose authority they carry, what gets "
        "written down — and rents only the mechanics of turning a conversation into tool "
        "calls. It was chosen after a live spike proved it could be intercepted at every "
        "step, which is what the consent card needs.",
        [
            ("Vercel AI SDK", "The strongest TypeScript streaming/tool ecosystem and the "
                              "most likely replacement; swapping it means re-verifying every "
                              "interception point the consent flow depends on."),
            ("LangGraph.js", "Explicit stateful graphs, good for long multi-step plans; more "
                             "orchestration machinery than an embedded turn needs."),
            ("OpenAI Agents SDK / Mastra", "Batteries-included agent runtimes with hosted "
                                           "tooling; both pull the loop toward one provider's "
                                           "shape."),
        ],
    ),
    (
        "OpenRouter",
        "Agents",
        "One gateway to every language model the organisation permits.",
        "Model choice is a product feature here: an owner curates an allow-list, a member "
        "picks from it, and the worker walks a ladder when nobody picked. One provider "
        "interface makes that a data question instead of an integration project, and it is "
        "also where the platform's no-Anthropic rule is applied on every rung.",
        [
            ("Direct provider APIs", "Fewer hops, better rate-limit control and lower "
                                     "latency; a separate integration, key and failure mode "
                                     "for every provider."),
            ("LiteLLM proxy", "The same routing under your own control, self-hosted; one more "
                              "service to run and keep available."),
            ("Portkey / Together", "Managed gateways with caching and observability built in; "
                                   "another vendor between the product and the model."),
        ],
    ),
    (
        "The NeurAI workflow engine (built here)",
        "Agents",
        "Versioned graphs, triggers, waits, approvals, bounded effects.",
        "A workflow in this product runs as a named person, under that person's row-level "
        "permissions, and stops for a human where the effect leaves the building. No "
        "general-purpose engine models that: they model steps and retries. Reusing the "
        "product's own identity and SQL state was cheaper than teaching an external engine "
        "the permission system.",
        [
            ("Temporal", "The reference for durable execution — worth revisiting at scale; a "
                         "separate cluster, a separate programming model, and the authority "
                         "question is still yours to solve."),
            ("n8n", "Hundreds of ready connectors and a visual builder; its permission model "
                    "is the credential's, not the person's."),
            ("Inngest / Trigger.dev", "Durable steps with very little infrastructure; a hosted "
                                      "dependency in the path of every background effect."),
        ],
    ),
    (
        "pgmq",
        "Data",
        "The durable queue behind the pipeline and the workflow engine (six queues).",
        "The jobs in this system are always about a row that was just written, so a queue "
        "INSIDE the same database means the message and the state it refers to commit "
        "together — no lost job, no job for a row that never landed. One less service to "
        "run, back up and secure.",
        [
            ("BullMQ + Redis", "The Node default, excellent tooling and rate limiting; adds "
                               "Redis, and a job can now commit while its row does not."),
            ("RabbitMQ", "Serious routing topologies and mature operations; far more than a "
                         "six-queue pipeline needs."),
            ("Amazon SQS / Cloud Tasks", "Fully managed and effectively infinite; the same "
                                         "split-brain risk plus a cloud dependency in the "
                                         "middle of the pipeline."),
        ],
    ),

    # ── the database ────────────────────────────────────────────────────
    (
        "PostgreSQL 17.6 (managed by Supabase)",
        "Data",
        "The record: 67 tables, transactions, and the permission wall itself.",
        "Everything this product promises — who may see a recording, that a decision cannot "
        "be silently rewritten, that a purge really removes the objects — is expressed as "
        "constraints and policies next to the data. Postgres is the only mainstream database "
        "where row-level security, transactional DDL, a queue extension and full-text search "
        "are the same system.",
        [
            ("Neon / serverless Postgres", "Same engine with branching and scale-to-zero — "
                                           "the most natural migration; today's managed auth "
                                           "and storage would have to be re-sourced."),
            ("AWS RDS / Aurora", "Maximum operational control and scale; more infrastructure "
                                 "to own and no auth/storage in the box."),
            ("Firebase / Firestore", "Fastest start and real-time by default; a document model "
                                     "and rule language that cannot express these joins, "
                                     "transactions or definer functions."),
        ],
    ),
    (
        "Row-level security, role grants and definer functions",
        "Security",
        "The authorization wall: 177 policies, RLS forced on all 67 tables, four database roles.",
        "Application code decides what to ASK for; the database decides what may be "
        "returned. Because the agent connects as a role with no DELETE anywhere, "
        "\"the assistant cannot delete your data\" is a property of the grant table rather "
        "than a sentence in a prompt — and the same wall holds for a bug, a mistake, or an "
        "injected instruction.",
        [
            ("Authorization in application code", "Simplest to write and to test in one "
                                                  "place; every new query is a new chance to "
                                                  "forget the filter."),
            ("OPA / Cedar policy engine", "Policies as reviewable artefacts across services; "
                                          "the decision still happens outside the data, so a "
                                          "missed call is an open door."),
            ("Casbin or a permissions library", "Familiar RBAC/ABAC models with less "
                                                "ceremony; same weakness — it is advice the "
                                                "query can ignore."),
        ],
    ),
    (
        "Supabase Auth (ES256 / JWKS)",
        "Security",
        "Sign-in, password recovery, and the signed identity every request carries.",
        "Identity ships with the same managed platform as the data, and the tokens are "
        "asymmetric: the core verifies signatures against a public JWKS and never holds a "
        "shared secret. The product keeps the decisions that matter to it — membership, "
        "role, org status — in its own tables.",
        [
            ("Auth0", "The most complete enterprise IdP with every protocol; another vendor "
                      "and a per-user price that grows with the product."),
            ("Clerk", "The best developer experience and ready UI for React; a second service "
                      "beside the database that already stores the members."),
            ("Keycloak / Ory", "Open source, self-hosted, no per-seat cost; a stateful "
                               "service the team would have to operate and patch."),
        ],
    ),
    (
        "Supabase Storage (S3-compatible)",
        "Data",
        "Recorded audio parts and meeting attachments, reached by short-lived signed URLs.",
        "Object bytes never pass through the API: the server mints a signed URL scoped to "
        "one object and hands it to the browser or to the speech service. Storage sits in "
        "the same project as the rows that describe it, so the purge can delete objects "
        "first and rows second and still be idempotent.",
        [
            ("Amazon S3", "The industry default, endless lifecycle and durability options; a "
                          "separate credential domain and IAM policy surface."),
            ("Cloudflare R2", "No egress fees and an S3-compatible API — attractive if media "
                              "volume grows; another provider to integrate and monitor."),
            ("MinIO (self-hosted)", "Full control and no per-GB bill; the team owns "
                                    "durability, backups and replication."),
        ],
    ),
    (
        "PostgreSQL full-text search with Persian folding",
        "Data",
        "Search across transcripts, summaries, titles and notes.",
        "Search runs under the same row-level policies as everything else, so a result set "
        "cannot leak a record the reader may not open. Persian normalisation (ی/ي, ک/ك, "
        "ZWNJ, digits) happens in one SQL function used by both the writer and the query, "
        "so what is indexed and what is searched can never disagree.",
        [
            ("OpenSearch / Elasticsearch", "Far better relevance, facets and scale; a second "
                                           "copy of your content that must be secured and "
                                           "kept in sync with the permission model."),
            ("Typesense / Meilisearch", "Excellent typo tolerance and speed with a small "
                                        "footprint; same synchronisation and access-control "
                                        "problem."),
            ("pgvector (semantic search)", "Meaning-based retrieval inside the same database "
                                           "— the natural next step rather than a replacement; "
                                           "needs an embedding budget and a re-index path."),
        ],
    ),
    (
        "Hand-written numbered migrations with self-checks",
        "Data",
        "207 ordered SQL files; each one proves its own claim before it commits.",
        "A migration here does not just alter the schema, it asserts what must now be true "
        "and rolls back if it is not — which is how a composite foreign key that could only "
        "ever raise was caught on the day it shipped. 65 standing SQL tests then re-assert "
        "the same walls against the live catalogue.",
        [
            ("Flyway / Liquibase", "The enterprise standard with rich tooling and "
                                   "undo/dry-run support; a JVM in the toolchain."),
            ("Prisma Migrate / Drizzle Kit", "Generates migrations from a schema you edit — "
                                             "much less typing; generated SQL is where policy "
                                             "and grant detail gets lost."),
            ("Atlas / sqitch", "Declarative or dependency-ordered migrations with strong "
                               "verification; another DSL between the author and the SQL."),
        ],
    ),

    # ── speech ──────────────────────────────────────────────────────────
    (
        "Soniox (primary speech recognition)",
        "Speech",
        "Persian and English transcription — asynchronous for files, streaming for live.",
        "Chosen by measurement, not by reputation: on the organisation's own Persian "
        "recordings it produced a 2.1% word error rate with word-level timings and correct "
        "ZWNJ handling. It also does both jobs — a five-hour upload and a live socket — "
        "which keeps one vendor and one vocabulary behind both lanes.",
        [
            ("Deepgram", "Comparable API and strong streaming latency; Persian is not a "
                         "headline language and would need the same acceptance corpus."),
            ("AssemblyAI", "Excellent English models and speaker labels out of the box; "
                           "weaker Persian coverage."),
            ("Whisper (OpenAI or self-hosted)", "Best-known multilingual model and can run "
                                                "on your own hardware; no true streaming, "
                                                "and self-hosting the large model needs a GPU "
                                                "this deployment does not have."),
        ],
    ),
    (
        "Silero VAD v5 (ONNX Runtime, local)",
        "Speech",
        "Finds the speech in an audio file before anything paid is called.",
        "Transcription is billed by the minute, and a recording is mostly silence. The "
        "detector runs locally on CPU in a fraction of real time, trims what nobody said, "
        "and reports how much speech it actually found — which is also what refuses an "
        "enrolment recorded on a muted microphone.",
        [
            ("WebRTC VAD", "Tiny, instant, no model file; far more false positives on room "
                           "noise, which puts silence back in the paid stream."),
            ("pyannote segmentation", "Learned segmentation with better boundaries; a Python "
                                      "runtime and a heavier model for the same decision."),
            ("Energy threshold", "No dependency at all; the version this product started "
                                 "with, and it could not tell a quiet speaker from a noisy "
                                 "room."),
        ],
    ),
    (
        "sherpa-onnx (diarization) + ERes2NetV2 (voiceprints)",
        "Speech",
        "Who spoke when, and whether that voice belongs to a known person.",
        "Both run locally, on CPU, with Node bindings — so voice biometrics never leave the "
        "server. The embedding model was replaced on 2026-09-07 after measuring four "
        "candidates on real recordings: the gap between the same voice across two "
        "microphones and the best impostor went from 0.014 (unusable — no threshold fits) "
        "to 0.226 with ERes2NetV2.",
        [
            ("pyannote.audio", "The research standard for diarization quality; a Python "
                               "service, and its pretrained models carry gated licences."),
            ("NVIDIA NeMo (TitaNet)", "Excellent speaker models and toolkit; built for GPU "
                                      "deployment and a much larger operational footprint."),
            ("A cloud diarization API", "No models to host and no CPU cost; sends a "
                                        "biometric identifier to a third party, which this "
                                        "product deliberately does not do."),
        ],
    ),
    (
        "FFmpeg / ffprobe",
        "Speech",
        "Decoding, resampling and inspecting whatever audio arrives.",
        "People upload whatever their phone made. One well-known binary turns every format "
        "into the single 16 kHz mono shape the speech stack expects, and answers the "
        "duration question before a long file is accepted.",
        [
            ("GStreamer", "Full media pipelines and hardware acceleration; a much larger API "
                          "for a conversion this simple."),
            ("SoX", "Purpose-built for audio conversion and effects; narrower container and "
                    "codec support."),
            ("A cloud transcoding service", "No binary to deploy; another network hop and "
                                            "another place the audio exists."),
        ],
    ),
    (
        "Piper (self-hosted TTS, four voices) with a hosted fallback",
        "Speech",
        "The platform's own voice, in Persian and English, on the server.",
        "Four small voice services run beside the API on loopback only, so spoken replies "
        "cost nothing per word and no text leaves the machine to be read aloud. Quality is "
        "below the best hosted voices, and the product says so rather than hiding it.",
        [
            ("ElevenLabs", "The most natural voices available and good Persian; per-character "
                           "pricing and every utterance sent to a third party."),
            ("Azure / Google TTS", "Strong neural voices with enterprise terms; same "
                                   "per-use cost and data-egress question."),
            ("Coqui / XTTS", "Open voice cloning with high quality; needs a GPU and much "
                             "more operational care."),
        ],
    ),

    # ── infrastructure ──────────────────────────────────────────────────
    (
        "Vercel (web tier)",
        "Infrastructure",
        "Hosts the Next.js app and its BFF routes; deploys on push.",
        "The interface changes many times a day and must never take the pipeline down with "
        "it, so the web tier deploys independently of the long-running services. Functions "
        "are pinned to Frankfurt to sit beside the API — a measured change that cut a "
        "round trip from 686 ms to 295 ms.",
        [
            ("Netlify", "Very close in model and pricing; slower to support new Next.js "
                        "features, which this app tracks closely."),
            ("Cloudflare Pages / Workers", "Best global latency and price at scale; a "
                                           "different runtime with real constraints for "
                                           "Node-specific code."),
            ("Self-hosted Next.js", "No vendor and no per-seat cost — it could run beside the "
                                    "API today; the team then owns TLS, CDN, rollbacks and "
                                    "scaling."),
        ],
    ),
    (
        "Hetzner Cloud + systemd",
        "Infrastructure",
        "The persistent tier: API, worker, speech service, four TTS voices, nightly purge.",
        "Speech inference is CPU-bound and long-running, which is exactly what serverless "
        "platforms bill worst and time out first. A single predictable VM with systemd units "
        "gives ONNX inference, a queue worker and a scheduled purge for a flat monthly cost, "
        "with plain restart/journal operations.",
        [
            ("AWS EC2 / ECS", "Every service you could need and real autoscaling; several "
                              "times the cost and far more configuration surface."),
            ("DigitalOcean / Linode", "Same shape with friendlier tooling; less CPU per "
                                      "euro, which matters for local inference."),
            ("Fly.io / Railway", "Deploys as easily as the web tier and scales by region; "
                                 "less predictable for pinned CPU work and local model files."),
        ],
    ),
    (
        "Cloudflare Tunnel + DNS",
        "Infrastructure",
        "Publishes api.neurai.pt without opening a port on the server.",
        "The origin makes an OUTBOUND connection; there is no inbound listener to find, scan "
        "or exploit, and no certificate to renew on the box. DNS, TLS and DDoS protection "
        "come with it, which is a lot of security posture for one daemon.",
        [
            ("nginx + Let's Encrypt", "Complete control and no third party in the path; you "
                                      "now expose and harden an origin and rotate certificates."),
            ("Tailscale Funnel", "Same no-inbound-port idea on a private network; a smaller "
                                 "edge and no CDN or WAF."),
            ("AWS ALB / API Gateway", "Enterprise ingress with managed certificates; only "
                                      "sensible if the rest of the stack moves to AWS."),
        ],
    ),
    (
        "GlitchTip (self-hosted, Sentry-compatible)",
        "Infrastructure",
        "Error envelopes from the services, on the organisation's own machine.",
        "Crash reports are content-adjacent by nature, so they stay on infrastructure the "
        "org controls. The wire format is Sentry's, which means the client libraries are "
        "standard and moving to hosted Sentry later is a URL change.",
        [
            ("Sentry (hosted)", "Best-in-class grouping, releases and performance data; your "
                                "stack traces and breadcrumbs live on someone else's servers."),
            ("Highlight / Bugsnag", "Good session replay and alerting; same data-residency "
                                    "question and another subscription."),
            ("OpenTelemetry + Grafana", "One portable pipeline for logs, traces and metrics; "
                                        "a collector and storage stack to run and pay for."),
        ],
    ),
    (
        "Vitest + Testing Library + jsdom",
        "Quality",
        "309 test files in web, core and ml; 2,921 tests on the last full run (db/ has its "
        "own SQL harness, 65 files).",
        "The same runner in every package, sharing the TypeScript config the product is "
        "written in, so a test can import the real module rather than a compiled shadow of "
        "it. Fast enough that the whole web suite runs on every change, which is what makes "
        "the guard tests (below) worth having.",
        [
            ("Jest", "The most widely used and best documented; slower on TypeScript and "
                     "ESM, which this repository is entirely built on."),
            ("node:test", "No dependency at all and shipped with the runtime; React and DOM "
                          "testing need assembling by hand."),
            ("Playwright Component Testing", "Real browser rendering rather than jsdom — "
                                             "truer results; far slower per test and heavier "
                                             "in CI."),
        ],
    ),
    (
        "Playwright",
        "Quality",
        "Renders the documentation diagrams and drives real-browser probes.",
        "Some facts can only be measured in a real browser — a computed colour, a native "
        "drag, a scroll that follows a growing thread. Playwright is scriptable, headless "
        "and deterministic enough to make those measurements repeatable instead of "
        "anecdotal.",
        [
            ("Puppeteer", "Same capability for Chromium and slightly lighter; no Firefox or "
                          "WebKit, and a weaker test story."),
            ("Cypress", "The friendliest debugging experience for interaction tests; single "
                        "browser context and awkward for multi-page capture work."),
            ("Selenium", "The broadest browser and language support; slower and more "
                         "brittle for this kind of work."),
        ],
    ),
]

# One-line pointers used in the appendix. Documentation home pages only —
# nothing here is a claim about a version.
SOURCES = [
    ("Web", "nextjs.org/docs", "react.dev", "tailwindcss.com/docs", "radix-ui.com/primitives",
     "next-intl.dev", "docs.livekit.io"),
    ("Core & agents", "fastify.dev/docs", "github.com/porsager/postgres", "zod.dev",
     "getpino.io", "openrouter.ai/docs", "github.com/earendil-works/pi"),
    ("Data", "postgresql.org/docs/17", "supabase.com/docs",
     "postgresql.org/docs/current/ddl-rowsecurity.html", "github.com/pgmq/pgmq"),
    ("Speech", "soniox.com/docs", "github.com/snakers4/silero-vad",
     "k2-fsa.github.io/sherpa/onnx", "ffmpeg.org/documentation.html",
     "github.com/rhasspy/piper"),
    ("Infrastructure", "vercel.com/docs", "docs.hetzner.com/cloud",
     "developers.cloudflare.com/cloudflare-one", "glitchtip.com/documentation"),
    ("Quality", "vitest.dev", "testing-library.com/docs", "playwright.dev/docs/intro"),
]
