import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createServiceClient, ensureBucket } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { ENV } from "./tokens";
import { ApiException } from "../common/errors";

// Derive the Supabase client type from the ingest helper — avoids a direct
// @supabase/supabase-js dependency in this package (it's already an ingest transitive dep).
type ServiceClient = ReturnType<typeof createServiceClient>;

/** Small, image-only. Logos/avatars are icons, not photos — 1.5 MB is generous. */
const MAX_BYTES = 1_500_000;
// Raster formats only. `image/svg+xml` is deliberately NOT here (security sweep M1): SVG is an active
// document — an uploaded `<svg><script>…` served inline from our public bucket is stored XSS. Logos
// and avatars have no need for vector, so the whole class is dropped rather than sanitized.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Verify the decoded bytes actually start with the declared type's magic number (security sweep L2)
 * — so a caller can't smuggle arbitrary content past the allowlist by mislabelling its `data:` MIME.
 * Returns true only when the bytes match `mime`. (SVG has no magic number and isn't allowed anyway.)
 */
function bytesMatchMime(mime: string, b: Buffer): boolean {
  switch (mime) {
    case "image/png":
      return (
        b.length >= 8 &&
        b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case "image/jpeg":
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/gif":
      return (
        b.length >= 6 &&
        (b.subarray(0, 6).toString("latin1") === "GIF87a" ||
          b.subarray(0, 6).toString("latin1") === "GIF89a")
      );
    case "image/webp":
      // RIFF <4-byte size> WEBP
      return (
        b.length >= 12 &&
        b.subarray(0, 4).toString("latin1") === "RIFF" &&
        b.subarray(8, 12).toString("latin1") === "WEBP"
      );
    default:
      return false;
  }
}

/**
 * Uploads small images (org logos, user avatars) to public Supabase Storage buckets and returns the
 * public URL callers persist (docs/12; Supabase = managed Storage only). The client sends a `data:`
 * URL (small images, inline in the request body); we decode, validate it's a real image within the
 * size cap, and upload with the service-role key (server-only — bypasses Storage RLS). Global so any
 * feature can reuse it; each bucket is lazily created public and remembered per process.
 */
@Injectable()
export class ImageUploadService {
  private readonly log = new Logger(ImageUploadService.name);
  private client: ServiceClient | null = null;
  private readonly buckets = new Map<string, Promise<void>>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Whether image upload is wired (Supabase Storage configured). */
  get enabled(): boolean {
    return Boolean(this.env.SUPABASE_URL && this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  /**
   * Upload a `data:image/...;base64,...` URL to `bucket` under `keyPrefix/` and return the public
   * URL. A fresh filename per upload busts the CDN cache (the previous object is orphaned —
   * negligible).
   */
  async upload(bucket: string, keyPrefix: string, dataUrl: string): Promise<string> {
    if (!this.enabled) {
      throw ApiException.invalidState("Image upload isn't configured on this deployment.");
    }
    const { mime, bytes } = decodeDataUrl(dataUrl);
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw ApiException.validation(
        [{ field: "image", issue: "must be a PNG, JPEG, WebP, or GIF image" }],
        "Unsupported image type.",
      );
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw ApiException.validation(
        [{ field: "image", issue: `must be ${Math.round(MAX_BYTES / 1000)} KB or smaller` }],
        "Image is too large.",
      );
    }
    // The declared MIME is in the allowlist — now prove the bytes are really that format (L2), so a
    // `data:image/png` header can't wrap a script/HTML/SVG payload.
    if (!bytesMatchMime(mime, bytes)) {
      throw ApiException.validation(
        [{ field: "image", issue: "file contents don't match its image type" }],
        "That doesn't look like a valid image.",
      );
    }

    const client = this.getClient();
    await this.ensureBucket(client, bucket);
    const path = `${keyPrefix}/${randomUUID()}.${ext}`;
    const { error } = await client.storage
      .from(bucket)
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (error) {
      this.log.error(`image upload failed (${bucket}/${keyPrefix}): ${error.message}`);
      throw ApiException.invalidState("Couldn't store the image. Please try again.");
    }
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** Remove every object under `<keyPrefix>/` in a bucket (e.g. an org's logos on org deletion).
   *  No-op when upload isn't configured. Best-effort: throws only on a hard Storage error. */
  async deleteByPrefix(bucket: string, keyPrefix: string): Promise<void> {
    if (!this.enabled) return;
    const client = this.getClient();
    const { data, error } = await client.storage.from(bucket).list(keyPrefix, { limit: 1000 });
    if (error) throw new Error(`image list failed (${bucket}/${keyPrefix}): ${error.message}`);
    if (!data || data.length === 0) return;
    const paths = data.map((o) => `${keyPrefix}/${o.name}`);
    const { error: rmErr } = await client.storage.from(bucket).remove(paths);
    if (rmErr) throw new Error(`image delete failed (${bucket}/${keyPrefix}): ${rmErr.message}`);
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

  private ensureBucket(client: ServiceClient, bucket: string): Promise<void> {
    // Create once per bucket per process; the promise is cached so concurrent uploads don't race.
    let ready = this.buckets.get(bucket);
    if (!ready) {
      ready = ensureBucket(client, bucket, { public: true }).catch((e: unknown) => {
        this.buckets.delete(bucket); // allow a retry on the next upload
        throw e;
      });
      this.buckets.set(bucket, ready);
    }
    return ready;
  }
}

/** Parse a `data:<mime>;base64,<payload>` URL into its mime + raw bytes. */
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  const mime = match?.[1];
  const payload = match?.[2];
  if (!mime || !payload) {
    throw ApiException.validation(
      [{ field: "image", issue: "must be a base64 data URL" }],
      "Invalid image.",
    );
  }
  return { mime: mime.toLowerCase(), bytes: Buffer.from(payload, "base64") };
}
