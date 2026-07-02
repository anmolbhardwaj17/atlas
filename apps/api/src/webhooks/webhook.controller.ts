import { Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import { WebhookService, type WebhookResult } from "./webhook.service";

/** The raw request shape the webhook needs: raw body (for HMAC) + GitHub headers. */
interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * GitHub webhook ingress (docs/07 §5). Unauthenticated by design — there is no Atlas
 * session; the HMAC signature (`x-hub-signature-256`) IS the authentication (verified in
 * the service before anything is trusted). Per-connection URL (`/webhooks/github/:id`) so
 * the handler knows which source to re-sync without a cross-org installation lookup. Always
 * returns 2xx once the signature is valid (so GitHub doesn't retry a handled event).
 */
@Controller("webhooks/github")
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(":connectionId")
  @HttpCode(200)
  async github(
    @Req() req: RawRequest,
    @Param("connectionId") connectionId: string,
  ): Promise<WebhookResult> {
    return this.webhooks.handleGithub(
      connectionId,
      header(req, "x-github-event") ?? "",
      header(req, "x-hub-signature-256"),
      req.rawBody ?? Buffer.alloc(0),
    );
  }
}

function header(req: RawRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
