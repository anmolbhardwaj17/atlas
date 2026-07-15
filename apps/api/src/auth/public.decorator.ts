import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "atlas:isPublic";

/**
 * Marks a controller/route as intentionally UNauthenticated — the global {@link AuthGuard} skips it.
 * Use only for endpoints authenticated by another means: the GitHub webhook (HMAC signature), the
 * digest unsubscribe (signed token), and the health probe. Everything else is authenticated by
 * default, so a new controller can never be left open by forgetting a guard.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
