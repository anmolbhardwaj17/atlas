import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createServiceClient, ensureBucket } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";
import { ApiException } from "../common/errors";

// Derive the Supabase client type from the ingest helper — avoids a direct
// @supabase/supabase-js dependency in this package (it's already an ingest transitive dep).
type ServiceClient = ReturnType<typeof createServiceClient>;

/** Public bucket that serves org logos by URL (no signed request needed to render one). */
const BUCKET = "org-logos";

/** Small, image-only. Logos are icons, not photos — 1.5 MB is generous. */
const MAX_BYTES = 1_500_000;
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * Uploads org logos to a public Supabase Storage bucket and returns the public URL we persist on
 * the organization (docs/12; Supabase = managed Storage only). The client sends a `data:` URL
 * (small images, inline in the PATCH/POST body); we decode, validate it's a real image within the
 * size cap, and upload with the service-role key (server-only — bypasses Storage RLS). Falls back
 * to a clear error when Supabase Storage isn't configured, so the org edit still succeeds sans logo.
 */
@Injectable()
export class OrgLogoService {
  private readonly log = new Logger(OrgLogoService.name);
  private client: ServiceClient | null = null;
  private bucketReady: Promise<void> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Whether logo upload is wired (Supabase Storage configured). */
  get enabled(): boolean {
    return Boolean(this.env.SUPABASE_URL && this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  /**
   * Upload a `data:image/...;base64,...` URL for an org; returns the stored public URL.
   * A fresh filename per upload busts the CDN cache (the previous object is orphaned — negligible).
   */
  async upload(orgId: string, dataUrl: string): Promise<string> {
    if (!this.enabled) {
      throw ApiException.invalidState("Logo upload isn't configured on this deployment.");
    }
    const { mime, bytes } = decodeDataUrl(dataUrl);
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw ApiException.validation(
        [{ field: "logo", issue: "must be a PNG, JPEG, WebP, GIF, or SVG image" }],
        "Unsupported image type.",
      );
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw ApiException.validation(
        [{ field: "logo", issue: `must be ${Math.round(MAX_BYTES / 1000)} KB or smaller` }],
        "Image is too large.",
      );
    }

    const client = this.getClient();
    await this.ensureBucket(client);
    const path = `${orgId}/${randomUUID()}.${ext}`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (error) {
      this.log.error(`org logo upload failed for ${orgId}: ${error.message}`);
      throw ApiException.invalidState("Couldn't store the logo. Please try again.");
    }
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  private getClient(): ServiceClient {
    if (!this.client) {
      this.client = createServiceClient(
        this.env.SUPABASE_URL!,
        this.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    }
    return this.client;
  }

  private ensureBucket(client: ServiceClient): Promise<void> {
    // Create once per process; the promise is cached so concurrent uploads don't race.
    if (!this.bucketReady) {
      this.bucketReady = ensureBucket(client, BUCKET, { public: true }).catch((e: unknown) => {
        this.bucketReady = null; // allow a retry on the next upload
        throw e;
      });
    }
    return this.bucketReady;
  }
}

/** Parse a `data:<mime>;base64,<payload>` URL into its mime + raw bytes. */
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  const mime = match?.[1];
  const payload = match?.[2];
  if (!mime || !payload) {
    throw ApiException.validation(
      [{ field: "logo", issue: "must be a base64 data URL" }],
      "Invalid image.",
    );
  }
  return { mime: mime.toLowerCase(), bytes: Buffer.from(payload, "base64") };
}
