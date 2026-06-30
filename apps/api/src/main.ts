import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { loadEnv } from "@atlas/config";
import { AppModule } from "./app.module";

/**
 * API entrypoint (docs/02 §3). Fastify adapter per docs/02 DD-3.
 * Config is parsed once at boot via @atlas/config (fail-fast, docs/16 CS-2 / docs/17 §6).
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  // The web app calls the API from the browser (Bearer token) — allow its origin (docs/08 §3).
  app.enableCors({
    origin: env.WEB_ORIGIN,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "x-atlas-org", "idempotency-key"],
  });
  app.enableShutdownHooks(); // run OnApplicationShutdown (closes the PG pool)
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  Logger.log(`API listening on :${env.PORT}`, "Bootstrap");
}

void bootstrap();
