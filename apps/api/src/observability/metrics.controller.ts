import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Env } from "@atlas/config";
import { Public } from "../auth/public.decorator";
import { ENV } from "../core/tokens";
import { MetricsService } from "./metrics.service";

// Structural subsets of the Fastify request/reply (the API doesn't depend on `fastify` directly —
// it's transitive via @nestjs/platform-fastify — so we type only what this handler touches).
interface ScrapeRequest {
  headers: { authorization?: string };
}
interface ScrapeReply {
  status(code: number): ScrapeReply;
  header(name: string, value: string): ScrapeReply;
  send(body: string): void;
}

/**
 * Prometheus scrape endpoint. `@Public` (no user JWT — scrapers aren't users), but optionally gated
 * by a bearer token (`METRICS_TOKEN`) so an internet-facing API doesn't leak request counts / route
 * names. Writes the raw exposition text via the Fastify reply so the `{ data }` envelope interceptor
 * doesn't wrap it (Prometheus needs the bare text format).
 */
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async scrape(@Req() req: ScrapeRequest, @Res() reply: ScrapeReply): Promise<void> {
    if (this.env.METRICS_TOKEN && !this.authorized(req)) {
      reply.status(401).header("www-authenticate", "Bearer").send("unauthorized");
      return;
    }
    const body = await this.metrics.render();
    reply.header("content-type", this.metrics.contentType).send(body);
  }

  /** Timing-safe bearer-token check (constant-time compare, same discipline as the rest of auth). */
  private authorized(req: ScrapeRequest): boolean {
    const expected = this.env.METRICS_TOKEN;
    if (!expected) return true;
    const header = req.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix)) return false;
    const got = Buffer.from(header.slice(prefix.length));
    const want = Buffer.from(expected);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
