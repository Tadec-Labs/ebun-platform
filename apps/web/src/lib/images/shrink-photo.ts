/**
 * Shrinks a phone photo before it leaves the phone.
 *
 * A camera original is 3–5 MB and 4000px wide; a gift card on /send is a
 * few hundred pixels. Resizing to 1200px on the longest side and saving
 * as WebP lands around 100–250 KB — about 20x less to upload on a
 * Nigerian mobile connection, and 20x less to store forever.
 *
 * Browser-only (canvas). Falls back to JPEG where WebP encoding isn't
 * supported (older iOS Safari). Throws a plain-language error the form
 * can show if the file can't be read as an image at all.
 */
const MAX_SIDE = 1200;
const QUALITY = 0.8;

export async function shrinkPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file isn't a photo we can read. Try another picture.");
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This phone couldn't prepare the photo. Try again.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

  const webp = await encode("image/webp");
  // Some browsers ignore the requested type and hand back PNG; only keep
  // WebP if that is genuinely what came back.
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("This phone couldn't prepare the photo. Try again.");
  return jpeg;
}
