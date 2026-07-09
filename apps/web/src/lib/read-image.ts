/**
 * Turn a user-picked image File into a compact `data:` URL the API can store as an org logo.
 * Raster images are downscaled to a small square-ish bound (logos render tiny) to keep the payload
 * well under the API's size cap; vector/animated formats (SVG, GIF) are passed through as-is with a
 * hard size guard so we don't rasterize away their whole point.
 */
const MAX_DIM = 512;

export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (PNG, JPEG, WebP, GIF, or SVG).");
  }
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    if (file.size > 1_000_000) throw new Error("Image is too large (max 1 MB for SVG/GIF).");
    return readAsDataUrl(file);
  }
  if (file.size > 8_000_000) throw new Error("Image is too large (max 8 MB).");
  const source = await readAsDataUrl(file);
  return downscale(source);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

function downscale(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Couldn't process that image."));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That image couldn't be loaded."));
    img.src = dataUrl;
  });
}
