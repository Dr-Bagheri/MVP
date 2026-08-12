/**
 * The /v1 surface (M1: api is one of core/'s two processes).
 *
 * Route handlers stay thin on purpose — auth, then a repo call, then a shape.
 * Every authorization decision lives below this file: RLS in db/, the wall in
 * agent/, the identity factory in db/identity.ts. A handler that started
 * making its own access decisions would be a fourth rule to keep in sync.
 *
 * Prefix is /v1 from day one because M17 exposes this surface to third
 * parties; the internal BFF hop and the public gateway must not diverge.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { assistantAllowed, createApiKeysRepo, type ApiKeysRepo } from "./apikeys.ts";
import { createAssistant } from "./assistant.ts";
import { createAuth, type Auth } from "./auth.ts";
import { createWebhooksRepo, type WebhooksRepo } from "./webhooks.ts";
import { createCallsRepo, type CallsRepo } from "./calls.ts";
import { mapError, NotActivatedError, pgErrorFields, ValidationError } from "./errors.ts";
import { createMembersRepo, type MembersRepo } from "./members.ts";
import { createModelsRepo, type ModelsRepo } from "./models.ts";
import { createTranscriptsRepo, type TranscriptsRepo } from "./transcripts.ts";
import { createDomainTools } from "../agent/domain-tools.ts";
import { createNamedSkillResolver, listResolvedSkills } from "../agent/skill-store.ts";
import type { DomainTool } from "../agent/tools.ts";
import type { Db } from "../db/identity.ts";
import type { Identity, Skill } from "../agent/types.ts";

export interface ServerOptions<TDeps> {
  db: Db;
  jwtSecret: string;
  issuer?: string | undefined;
  /** Omit for the shipped domain tools; `[]` deliberately means none. */
  tools?: DomainTool<TDeps, never>[] | undefined;
  toolDeps: TDeps;
  adminOnlyTools?: ReadonlySet<string> | undefined;
  /** Resolve a skill slug for the caller (system < org < user). */
  resolveSkill?: ((identity: Identity, slug: string) => Promise<Skill | undefined>) | undefined;
  openrouterKey?: string | undefined;
  logger?: boolean;
}

export function buildServer<TDeps>(options: ServerOptions<TDeps>): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const auth: Auth = createAuth({
    db: options.db, jwtSecret: options.jwtSecret, issuer: options.issuer,
  });
  const calls: CallsRepo = createCallsRepo(options.db);
  const transcripts: TranscriptsRepo = createTranscriptsRepo(options.db);
  const models: ModelsRepo = createModelsRepo(options.db);
  const members: MembersRepo = createMembersRepo(options.db);
  const keys: ApiKeysRepo = createApiKeysRepo(options.db);
  const webhooks: WebhooksRepo = createWebhooksRepo(options.db);
  // One resolver for the assistant's `/slug` and the pipeline's summarizer.
  // A caller may still inject its own, but the default is the shared one —
  // if the summarizer resolved skills differently, an org that customised the
  // summarizer prompt would see it applied in one place and not the other,
  // which reads as the model behaving inconsistently rather than as a bug.
  const resolveSkillFor = options.resolveSkill ?? createNamedSkillResolver(options.db);
  /**
   * The four read tools from db/0015's system skill, unless a caller supplied
   * its own set. Defaulted rather than required because an api built without
   * them silently produces an assistant that cannot search — not the
   * assistant SPEC describes, and it looks like a bad model rather than a
   * missing wire.
   *
   * The check is `=== undefined`, NOT `.length > 0`. An explicit `tools: []`
   * means "this server has no tools" and must be honoured; treating it as
   * "unspecified" would override a caller's deliberate choice with a default
   * — the same absent-vs-empty confusion this codebase keeps finding in other
   * people's code, and it was in my own option handling within an hour of my
   * writing that sentence to the steward.
   */
  const domainTools = options.tools === undefined
    ? (createDomainTools() as unknown as DomainTool<TDeps, never>[])
    : options.tools;
  const domainDeps = options.tools === undefined
    ? ({ db: options.db } as unknown as TDeps)
    : options.toolDeps;

  const assistant = createAssistant({
    db: options.db,
    tools: domainTools,
    deps: domainDeps,
    adminOnlyTools: options.adminOnlyTools,
    apiKey: options.openrouterKey,
  });

  /** One error path for every route — no handler formats its own. */
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    if (mapped.ours) {
      // ours: log the TYPE, tell the caller nothing. Never the message —
      // it may quote a transcript, and "no content in logs" is M9/invariant 7.
      const kind = error instanceof Error ? error.constructor.name : typeof error;
      // For a database failure, structured schema identifiers instead: they
      // say WHICH rule broke, and unlike the message they cannot contain a
      // row value (steward-ratified convention).
      request.log.error({ err: kind, pg: pgErrorFields(error) }, "internal error");
    }
    reply.code(mapped.status).send(mapped.body);
  });

  /**
   * A mistyped URL must answer in the SAME shape as a hidden row.
   *
   * Fastify's built-in 404 does not pass through setErrorHandler — it emits
   * `{message, error, statusCode}`, a third error shape the BFF would have to
   * special-case. Found by curling a nonexistent path against a running
   * instance; no test caught it because tests only request routes that exist.
   *
   * It also matters beyond tidiness: "no such route" and "row you may not
   * see" being distinguishable by SHAPE would undo the 404-not-403 posture at
   * the routing layer, which is where nobody would think to look for it.
   */
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: "not found", kind: "not_found" });
  });

  app.get("/health", async () => ({ ok: true }));

  // ---- calls -------------------------------------------------------------

  app.get("/v1/calls", async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await auth.requireActive(request);
    const query = request.query as { limit?: string; before?: string };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && !Number.isFinite(limit)) {
      throw new ValidationError("limit must be a number");
    }
    return reply.send({ calls: await calls.list(identity, { limit, before: query.before }) });
  });

  app.get("/v1/calls/:id", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    return reply.send(await calls.get(identity, id));
  });

  app.patch("/v1/calls/:id", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { title?: unknown; scope?: unknown };
    if (body.title !== undefined && typeof body.title !== "string") {
      throw new ValidationError("title must be a string");
    }
    if (body.scope !== undefined && typeof body.scope !== "string") {
      throw new ValidationError("scope must be a string");
    }
    return reply.send(await calls.update(identity, id, {
      title: body.title as string | undefined,
      scope: body.scope as "private" | "org" | undefined,
    }));
  });

  app.delete("/v1/calls/:id", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    await calls.softDelete(identity, id);   // soft — M11
    return reply.code(204).send();
  });

  // ---- transcripts, summaries, search ------------------------------------

  /** One numeric query param, parsed once, rejected loudly. */
  const num = (raw: string | undefined, name: string): number | undefined => {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new ValidationError(`${name} must be a number`);
    return value;
  };

  app.get("/v1/calls/:id/transcript", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    const query = request.query as { from_ms?: string; to_ms?: string; limit?: string };
    // The call read is what turns an invisible call into 404 rather than an
    // empty transcript — an empty array would mean "this call has no words",
    // which is a different (and probeable) claim.
    await calls.get(identity, id);
    const segments = await transcripts.segments(identity, id, {
      fromMs: num(query.from_ms, "from_ms"),
      toMs: num(query.to_ms, "to_ms"),
      limit: num(query.limit, "limit"),
    });
    return reply.send({ call_id: id, segments });
  });

  app.get("/v1/calls/:id/summary", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    await calls.get(identity, id);
    return reply.send(await transcripts.currentSummary(identity, id));
  });

  /** History, because a regenerated summary must not destroy the old one. */
  app.get("/v1/calls/:id/summaries", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const { id } = request.params as { id: string };
    await calls.get(identity, id);
    return reply.send({ summaries: await transcripts.summaries(identity, id) });
  });

  app.get("/v1/search", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const query = request.query as { q?: string; limit?: string; call_id?: string };
    if (typeof query.q !== "string") throw new ValidationError("q is required");
    return reply.send({
      hits: await transcripts.search(identity, query.q, {
        limit: num(query.limit, "limit"),
        callId: query.call_id,
      }),
    });
  });

  // ---- skills (M4: agents are configuration) -----------------------------

  /**
   * What this caller may invoke. Already collapsed by precedence, so an org
   * override appears once under the org's wording rather than twice — the
   * picker should show what would actually run.
   */
  app.get("/v1/skills", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const skills = await listResolvedSkills(options.db, identity);
    // The PROMPT stays off the wire. It is the org's configuration, it can
    // carry instructions a member should not be able to read and quote back
    // at the model, and no picker needs it. That is the wall doing its job,
    // not a field someone should later "notice is missing" and add.
    return reply.send({
      skills: skills.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        level: s.level,
        /**
         * Tool names ARE on the wire, and withholding them would have been
         * incoherent rather than careful: the assistant stream already emits
         * `tool_call` events carrying the tool's name while a skill runs, so
         * a user watching a run sees the tool list anyway. Hiding it in the
         * picker and showing it during execution protects nothing and makes
         * the picker less useful than the thing it launches.
         */
        tools: s.tools,
        /** Which model the skill pins, or null = the caller's choice (M5). */
        model: s.model,
        /**
         * An affordance hint, NOT the wall. db/0013's skill_org_write /
         * skill_user_write decide who may actually edit; this exists so the
         * UI doesn't offer a button that will fail. Computed here rather than
         * derived client-side so the rule lives in one place — and it is a
         * strictly weaker claim than the policy, never a wider one.
         */
        editable: s.level === "org"
          ? identity.role === "admin"
          : s.level === "user",
      })),
    });
  });

  // ---- models (M5: the user picks; the product imposes nothing) ----------

  app.get("/v1/models", async (request, reply) => {
    const identity = await auth.requireActive(request);
    return reply.send(await models.list(identity));
  });

  app.put("/v1/models/preferred", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const body = (request.body ?? {}) as { model?: unknown };
    // null is a real value here — "I have no preference" — and must not be
    // confused with a missing field, so it is accepted explicitly.
    if (body.model !== null && typeof body.model !== "string") {
      throw new ValidationError("model must be a string or null");
    }
    return reply.send(await models.choose(identity, body.model));
  });

  // ---- members and the pending queue (M15) --------------------------------

  app.get("/v1/admin/members", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    return reply.send({ members: await members.list(identity) });
  });

  app.post("/v1/admin/members/:id/accept", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const { id } = request.params as { id: string };
    return reply.send(await members.accept(identity, id));
  });

  app.patch("/v1/admin/members/:id", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { role?: unknown; status?: unknown };
    if (body.role !== undefined && typeof body.role !== "string") {
      throw new ValidationError("role must be a string");
    }
    if (body.status !== undefined && typeof body.status !== "string") {
      throw new ValidationError("status must be a string");
    }
    return reply.send(await members.update(identity, id, {
      role: body.role as "admin" | "member" | undefined,
      status: body.status as "active" | "disabled" | undefined,
    }));
  });

  // ---- gateway administration (M17) --------------------------------------
  //
  // Managing keys and webhooks is admin-only, enforced by RLS (db/0013's
  // api_key_admin / webhook_admin). `requireAdmin` is here so a non-admin
  // gets one legible 403 instead of a confusing empty result, not because it
  // is the authority — if these two ever disagree, SQL wins, which is the
  // right way round.

  app.post("/v1/gateway/keys", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const body = (request.body ?? {}) as {
      name?: unknown; actor_id?: unknown; expires_at?: unknown; allow_assistant?: unknown;
    };
    if (typeof body.name !== "string") throw new ValidationError("name is required");
    if (body.allow_assistant !== undefined && typeof body.allow_assistant !== "boolean") {
      // A capability grant is not a place to be lenient about "true" vs true.
      throw new ValidationError("allow_assistant must be a boolean");
    }
    // The token is in this response and NOWHERE else, ever again.
    return reply.code(201).send(await keys.create(identity, {
      name: body.name,
      actorId: typeof body.actor_id === "string" ? body.actor_id : undefined,
      expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined,
      allowAssistant: body.allow_assistant === true,
    }));
  });

  app.get("/v1/gateway/keys", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    return reply.send({ keys: await keys.list(identity) });
  });

  app.delete("/v1/gateway/keys/:id", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const { id } = request.params as { id: string };
    await keys.revoke(identity, id);   // stamped, not deleted
    return reply.code(204).send();
  });

  app.post("/v1/gateway/webhooks", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const body = (request.body ?? {}) as { url?: unknown; events?: unknown };
    if (typeof body.url !== "string") throw new ValidationError("url is required");
    if (!Array.isArray(body.events)) throw new ValidationError("events must be an array");
    return reply.code(201).send(await webhooks.create(identity, {
      url: body.url, events: body.events as string[],
    }));
  });

  app.get("/v1/gateway/webhooks", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    return reply.send({ webhooks: await webhooks.list(identity) });
  });

  app.patch("/v1/gateway/webhooks/:id", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") throw new ValidationError("enabled must be a boolean");
    return reply.send(await webhooks.setEnabled(identity, id, body.enabled));
  });

  app.get("/v1/gateway/deliveries", async (request, reply) => {
    const identity = await auth.requireAdmin(request);
    const query = request.query as { webhook_id?: string; limit?: string };
    return reply.send({
      deliveries: await webhooks.deliveries(identity, {
        webhookId: query.webhook_id, limit: num(query.limit, "limit"),
      }),
    });
  });

  // ---- assistant (SSE) ---------------------------------------------------

  app.post("/v1/assistant/ask", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const body = (request.body ?? {}) as {
      question?: unknown; model?: unknown; call_id?: unknown; skill?: unknown;
    };
    if (typeof body.question !== "string" || body.question.trim() === "") {
      throw new ValidationError("question is required");
    }
    // M17 amendment (db/0022): a gateway key reaches the assistant only if an
    // admin opened it. Checked BEFORE the stream is opened — once headers are
    // out the only way to refuse is an error event, which is a worse thing to
    // hand an integrator than a 403.
    if (!assistantAllowed(identity)) {
      throw new NotActivatedError("this api key may not use the assistant");
    }

    let skill: Skill | undefined;
    if (typeof body.skill === "string" && body.skill) {
      skill = await resolveSkillFor(identity, body.skill);
      if (!skill) throw new ValidationError(`unknown skill: ${body.skill}`);
    }

    // Headers must go out before the first event or proxies may buffer.
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Client hang-up aborts the run — a browser tab closing should stop
    // spending tokens, not orphan a stream.
    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());

    await assistant.ask({
      identity,
      question: body.question,
      skill,
      model: typeof body.model === "string" ? body.model : undefined,
      callId: typeof body.call_id === "string" ? body.call_id : null,
      signal: controller.signal,
    }, {
      write: (chunk) => { reply.raw.write(chunk); },
      end: () => { reply.raw.end(); },
    });

    // Fastify must not also try to reply — we own the socket now.
    return reply;
  });

  return app;
}
