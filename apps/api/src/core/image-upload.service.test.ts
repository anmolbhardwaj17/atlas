import { describe, it, expect } from "vitest";
import { loadEnv } from "@atlas/config";
import { ImageUploadService } from "./image-upload.service";

// Security sweep H4 (M1/L2): the upload validators run BEFORE any Supabase call, so the rejection
// paths are unit-testable with no network. Enable the service with a fake Supabase env; a valid
// upload would then hit storage (not exercised here — we only assert the guards reject bad input).

const env = loadEnv({
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
});
const svc = new ImageUploadService(env);
const dataUrl = (mime: string, bytes: Buffer): string =>
  `data:${mime};base64,${bytes.toString("base64")}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("ImageUploadService validation", () => {
  it("rejects SVG (dropped from the allowlist — stored-XSS class)", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(svc.upload("avatars", "u1", dataUrl("image/svg+xml", svg))).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("rejects a non-image mime", async () => {
    await expect(
      svc.upload("avatars", "u1", dataUrl("text/html", Buffer.from("<h1>hi</h1>"))),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a MIME that lies about its bytes (magic-byte check, L2)", async () => {
    // Declares PNG but the bytes are not a PNG — must be refused, not stored.
    await expect(
      svc.upload(
        "avatars",
        "u1",
        dataUrl("image/png", Buffer.from("this is definitely not a png")),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects an oversized image (before the magic check)", async () => {
    const big = Buffer.alloc(1_600_000, 0x41); // > 1.5 MB decoded
    await expect(svc.upload("avatars", "u1", dataUrl("image/png", big))).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("rejects a non-data-URL string", async () => {
    await expect(
      svc.upload("avatars", "u1", "https://evil.example.com/x.png"),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses entirely when storage isn't configured", async () => {
    const disabled = new ImageUploadService(loadEnv({}));
    await expect(disabled.upload("avatars", "u1", dataUrl("image/png", PNG))).rejects.toMatchObject(
      {
        code: "invalid_state_transition",
      },
    );
  });
});
