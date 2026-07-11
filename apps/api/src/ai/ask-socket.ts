/**
 * WebSocket transport for the Ask AI conversation stream (docs/plans/ai-knowledge-engine-p1-design
 * §9.1, DD-P1-5). REST stays for CRUD; this is only the LIVE answer channel — bidirectional so the
 * user can cancel/interrupt a running answer (stopping tool-loop + LLM cost server-side), and the
 * agentic loop's many progress events flow over one persistent connection.
 *
 * Protocol (JSON frames):
 *   client → server: {t:"auth", token, orgId} · {t:"ask", conversationId, message} · {t:"cancel"}
 *   server → client: {t:"ready"} · the AnswerEvent union (retrieval_step/token/citation/…) · {type:"error"}
 *
 * Security: same as the SSE guards — verify the Supabase JWT (first frame, NOT the URL, so no token
 * leaks to logs/proxies) then confirm org membership (R8). Origin is pinned to WEB_ORIGIN.
 */
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { Env } from "@atlas/config";
import { SupabaseJwtVerifier } from "../auth/supabase-jwt.verifier";
import { MembershipService } from "../auth/membership.service";
import { parseAuthClaims } from "../auth/claims";
import { ApiException } from "../common/errors";
import { ENV } from "../core/tokens";
import { AiService } from "./ai.service";

const logger = new Logger("AskSocket");

/** The subset of the `ws` WebSocket we use (avoids a hard `ws` type dependency). */
interface WsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "close" | "pong", cb: () => void): void;
}
interface WsCapableFastify {
  register(plugin: unknown): Promise<void>;
  get(
    path: string,
    opts: { websocket: true },
    handler: (socket: WsSocket, req: { headers: Record<string, string | undefined> }) => void,
  ): void;
}

interface InFrame {
  t?: string;
  token?: string;
  orgId?: string;
  conversationId?: string;
  message?: string;
}

export async function registerAskSocket(app: NestFastifyApplication): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance() as unknown as WsCapableFastify;
  // NOTE: `await fastify.register(...)` triggers Fastify's ready() (the instance is thenable), which
  // is what lets the `{ websocket: true }` route below be recognized — so this MUST run after
  // app.init(), not before (before init would boot Fastify ahead of Nest's own route mapping).
  //
  // In dev, Node's --watch can SIGTERM the previous process mid-boot (files still settling during
  // the concurrent monorepo build). enableShutdownHooks() then boots the root as it tears down, so
  // this register() lands on an already-booted root and throws AVV_ERR_ROOT_PLG_BOOTED. That process
  // is being replaced anyway — swallow this one specific error (a benign hot-reload race) instead of
  // crashing with a stack trace. Any other failure is real and rethrown.
  try {
    await fastify.register(fastifyWebsocket);
  } catch (err) {
    if ((err as { code?: string }).code === "AVV_ERR_ROOT_PLG_BOOTED") {
      logger.warn("Ask WebSocket setup skipped: server already booted (dev hot-reload race).");
      return;
    }
    throw err;
  }

  const verifier = app.get(SupabaseJwtVerifier, { strict: false });
  const memberships = app.get(MembershipService, { strict: false });
  const ai = app.get(AiService, { strict: false });
  const env = app.get<Env>(ENV, { strict: false });

  fastify.get("/ai/ws", { websocket: true }, (socket, req) => {
    // Only our web app may open the socket (browsers still send Origin on the WS handshake).
    const origin = req.headers.origin ?? "";
    if (env.WEB_ORIGIN && origin && origin !== env.WEB_ORIGIN) {
      socket.close(1008, "origin not allowed");
      return;
    }

    let orgId: string | null = null;
    let userId: string | null = null;
    let current: AbortController | null = null;
    const send = (obj: unknown): void => {
      try {
        socket.send(JSON.stringify(obj));
      } catch {
        /* peer gone */
      }
    };

    // Heartbeat: ping every 30s; terminate a peer that stops ponging (dead-connection reaping).
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const hb = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      try {
        socket.ping();
      } catch {
        clearInterval(hb);
      }
    }, 30_000);

    socket.on("close", () => {
      clearInterval(hb);
      current?.abort(); // disconnect cancels in-flight work (cost) server-side
    });

    socket.on("message", (raw) => {
      void (async () => {
        let msg: InFrame;
        try {
          msg = JSON.parse(String(raw)) as InFrame;
        } catch {
          send({ type: "error", message: "bad frame" });
          return;
        }

        if (msg.t === "auth") {
          try {
            const claims = parseAuthClaims(await verifier.verify(String(msg.token ?? "")));
            const member = (await memberships.listForUser(claims.userId)).find(
              (m) => m.id === msg.orgId,
            );
            if (!member) {
              send({ type: "error", message: "no access to this organization" });
              socket.close(1008, "forbidden");
              return;
            }
            orgId = member.id;
            userId = claims.userId;
            send({ t: "ready" });
          } catch {
            send({ type: "error", message: "invalid or expired token" });
            socket.close(1008, "unauthorized");
          }
          return;
        }

        if (msg.t === "cancel") {
          current?.abort();
          return;
        }

        if (msg.t === "ask") {
          if (!orgId) {
            send({ type: "error", message: "not authenticated" });
            return;
          }
          if (!msg.conversationId || !msg.message) {
            send({ type: "error", message: "missing conversationId or message" });
            return;
          }
          current?.abort(); // one in-flight answer per socket
          const ac = new AbortController();
          current = ac;
          try {
            for await (const ev of ai.askStream(
              orgId,
              msg.conversationId,
              msg.message,
              userId,
              ac.signal,
            )) {
              if (ac.signal.aborted) break;
              send(ev);
            }
          } catch (err) {
            if (!ac.signal.aborted) {
              // Only surface our own ApiException messages (rate-limit, bad key, honest states);
              // anything else is logged and shown generically so no raw internal error leaks (M3).
              let clientMessage = "The AI request failed. Please try again.";
              if (err instanceof ApiException) {
                clientMessage = err.message;
              } else {
                logger.error(`AI ask (ws) failed: ${(err as Error).message}`);
              }
              send({ type: "error", message: clientMessage });
            }
          } finally {
            if (current === ac) current = null;
          }
        }
      })();
    });
  });
}
