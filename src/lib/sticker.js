import { fileToBase64 } from "@/lib/media";

/**
 * WhatsApp only renders WebP stickers, drawn on a square canvas. These mirror
 * WhatsApp's own limits: 512x512 for the canvas, 100 KB for a static sticker
 * and 500 KB for an animated one.
 */
export const STICKER_DIMENSION = 512;
export const MAX_STICKER_BYTES = 100 * 1024;
export const MAX_ANIMATED_STICKER_BYTES = 500 * 1024;

/** WebP qualities tried in order until the encoded sticker fits the cap. */
const QUALITIES = [0.9, 0.75, 0.6, 0.45];
/** Canvas sizes tried in order (512px first, then a smaller fallback). */
const SIZES = [STICKER_DIMENSION, 256];

/**
 * Decode a picked image into something drawable, keeping a release handle so
 * the caller can free the bitmap/object URL once it has been drawn.
 *
 * @param {File} file
 * @returns {Promise<{ source: CanvasImageSource, width: number, height: number, release: () => void }>}
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close?.(),
      };
    } catch {
      // SVG and a few other formats aren't decodable as a bitmap; the <img>
      // path below handles everything the browser can render.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That image can't be read"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function encodeWebp(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("That image can't be converted")),
      "image/webp",
      quality
    );
  });
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Failed to read image"));
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Whether a file is an animated WebP (its RIFF header carries the ANIM/ANMF
 * chunks). Canvas re-encoding would drop the frames, so these are left alone.
 *
 * @param {File} file
 * @returns {Promise<boolean>}
 */
async function isAnimatedWebp(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.includes("ANIM") || text.includes("ANMF");
}

/**
 * Turn a picked image into a WhatsApp-ready sticker: squared to 512x512
 * (centred, with transparent padding), re-encoded as WebP and shrunk until it
 * fits the 100 KB cap. A file that is already a small WebP is passed through
 * untouched, so animated stickers keep their frames.
 *
 * @param {File} file
 * @returns {Promise<{ data: string, mimeType: string, size: number }>}
 */
export async function imageToSticker(file) {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Pick an image to use as a sticker");
  }
  if (file.type === "image/webp") {
    // Animated stickers get the larger WhatsApp allowance and are only left
    // alone while they fit it.
    const cap = (await isAnimatedWebp(file))
      ? MAX_ANIMATED_STICKER_BYTES
      : MAX_STICKER_BYTES;
    if (file.size <= cap) {
      const { data } = await fileToBase64(file);
      return { data, mimeType: "image/webp", size: file.size };
    }
  }

  const image = await decodeImage(file);
  try {
    if (!image.width || !image.height) {
      throw new Error("That image can't be read");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't convert images");

    for (const size of SIZES) {
      canvas.width = size;
      canvas.height = size;
      // Fit the art inside the square, centred, leaving the rest transparent:
      // WhatsApp crops stickers that aren't square.
      const scale = Math.min(size / image.width, size / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      context.clearRect(0, 0, size, size);
      context.drawImage(
        image.source,
        Math.round((size - width) / 2),
        Math.round((size - height) / 2),
        width,
        height
      );

      for (const quality of QUALITIES) {
        const blob = await encodeWebp(canvas, quality);
        // Browsers without a WebP encoder silently fall back to PNG.
        if (blob.type !== "image/webp") {
          throw new Error("This browser can't create WebP stickers");
        }
        if (blob.size <= MAX_STICKER_BYTES) {
          return {
            data: await blobToDataUrl(blob),
            mimeType: "image/webp",
            size: blob.size,
          };
        }
      }
    }
  } finally {
    image.release();
  }

  throw new Error("That image is too detailed to fit in a sticker");
}
