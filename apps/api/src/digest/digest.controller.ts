import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { WeeklyDigestService } from "./weekly-digest.service";

interface UnsubscribeBody {
  u?: string; // user id
  o?: string; // org id
  t?: string; // HMAC token
}

/**
 * Weekly-digest unsubscribe (#44). Unauthenticated by design — the recipient clicks a link from an
 * email and has no Atlas session — so the signed token IS the authentication (verified in the service
 * before anything is written). Always returns 200 with `{ ok }` so the page can render a clean state
 * either way and we never leak whether a given (user, org) pair exists.
 */
@Controller("email")
export class DigestController {
  constructor(private readonly digest: WeeklyDigestService) {}

  @Post("unsubscribe")
  @HttpCode(200)
  async unsubscribe(@Body() body: UnsubscribeBody): Promise<{ ok: boolean }> {
    const { u, o, t } = body;
    if (!u || !o || !t) return { ok: false };
    const ok = await this.digest.unsubscribe(u, o, t);
    return { ok };
  }
}
