import { Injectable } from "@nestjs/common";
import { ImageUploadService } from "../core/image-upload.service";

/** Org logos live in the public `org-logos` bucket, keyed by org id. Thin wrapper over the shared
 *  {@link ImageUploadService} so org code keeps its focused API. */
const BUCKET = "org-logos";

@Injectable()
export class OrgLogoService {
  constructor(private readonly images: ImageUploadService) {}

  get enabled(): boolean {
    return this.images.enabled;
  }

  /** Upload a `data:image/...;base64,...` logo for an org; returns the stored public URL. */
  upload(orgId: string, dataUrl: string): Promise<string> {
    return this.images.upload(BUCKET, orgId, dataUrl);
  }

  /** Erase an org's logo object(s) — called on org deletion so nothing is left in Storage. */
  delete(orgId: string): Promise<void> {
    return this.images.deleteByPrefix(BUCKET, orgId);
  }
}
