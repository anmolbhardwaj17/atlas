import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { loadEnv } from "@atlas/config";
import { AppModule } from "./app.module";
import { registerAskSocket } from "./ai/ask-socket";

/**
 * API entrypoint (docs/02 §3). Fastify adapter per docs/02 DD-3.
 * Config is parsed once at boot via @atlas/config (fail-fast, docs/16 CS-2 / docs/17 §6).
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // Correlation id (docs/02 §9.4): reuse an inbound `x-request-id` if the caller/proxy set
  // one, else generate. Fastify puts it on `request.id`; the logging interceptor + error
  // filter thread it through so one request is traceable end to end across logs + responses.
  const adapter = new FastifyAdapter({
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // Fastify's default body cap is 1 MiB, which is smaller than the image-upload caps
    // (decoded 1.5 MB → ~2 MB as base64, and the /me avatar zod cap is 3 MB), so a legit logo/
    // avatar would fail with a confusing 413 before our own validators run. Lift it so the request
    // reaches the handler and the ImageUploadService returns a clean, specific error (L1).
    bodyLimit: 4_000_000,
  });
  // Echo the correlation id back so the client (and the browser Network tab) can quote it,
  // and set baseline security headers (docs/13). This is a JSON API (no HTML), so no CSP is
  // needed; HSTS is applied at the TLS-terminating edge in deploy (docs/17).
  adapter.getInstance().addHook("onRequest", (req, reply, done) => {
    void reply.header("x-request-id", String(req.id));
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("x-frame-options", "DENY");
    void reply.header("referrer-policy", "no-referrer");
    done();
  });
  // rawBody: keep the exact request bytes on `req.rawBody` so the GitHub webhook can verify
  // its HMAC signature over what was actually sent (a re-serialized JSON body wouldn't match).
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true,
  });
  // The web app calls the API from the browser (Bearer token) - allow its origin (docs/08 §3).
  app.enableCors({
    origin: env.WEB_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "x-atlas-org", "idempotency-key"],
  });
  app.enableShutdownHooks(); // run OnApplicationShutdown (closes the PG pool)
  await app.init(); // resolve providers before registering the raw WS route below
  await registerAskSocket(app); // live Ask AI channel (WebSocket) alongside the REST/SSE API
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  Logger.log(`API listening on :${env.PORT}`, "Bootstrap");
}

void bootstrap();
