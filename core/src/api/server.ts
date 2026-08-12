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

import { createAssistant } from "./assistant.ts";
import { createAuth, type Auth } from "./auth.ts";
import { createCallsRepo, type CallsRepo } from "./calls.ts";
import { mapError, ValidationError } from "./errors.ts";
import type { DomainTool } from "../agent/tools.ts";
import type { Db } from "../db/identity.ts";
import type { Identity, Skill } from "../agent/types.ts";

export interface ServerOptions<TDeps> {
  db: Db;
  jwtSecret: string;
  issuer?: string | undefined;
  tools: DomainTool<TDeps, never>[];
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
  const assistant = createAssistant({
    db: options.db,
    tools: options.tools,
    deps: options.toolDeps,
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
      request.log.error({ err: kind }, "internal error");
    }
    reply.code(mapped.status).send(mapped.body);
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

  // ---- assistant (SSE) ---------------------------------------------------

  app.post("/v1/assistant/ask", async (request, reply) => {
    const identity = await auth.requireActive(request);
    const body = (request.body ?? {}) as {
      question?: unknown; model?: unknown; call_id?: unknown; skill?: unknown;
    };
    if (typeof body.question !== "string" || body.question.trim() === "") {
      throw new ValidationError("question is required");
    }

    let skill: Skill | undefined;
    if (typeof body.skill === "string" && body.skill && options.resolveSkill) {
      skill = await options.resolveSkill(identity, body.skill);
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
