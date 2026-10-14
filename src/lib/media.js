/** @typedef {"image" | "video" | "audio" | "document" | "sticker"} MediaType */

// Mirrors the backend cap (~20 MB). Files above this are rejected before upload.
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_LABEL = "20 MB";

/**
 * Read a File into a base64 data URL.
 *
 * The data: prefix is intentionally kept — the backend strips it before
 * forwarding to WhatsApp.
 *
 * @param {File} file
 * @returns {Promise<{ data: string, mimeType: string }>}
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve({ data: result, mimeType: file.type });
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Map a MIME type to the backend's media bucket.
 *
 * @param {string} [mimeType]
 * @returns {MediaType}
 */
export function getMediaType(mimeType) {
  if (!mimeType) return "document";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Human-readable file size, e.g. "1.4 MB".
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MEDIA_EMOJI = {
  image: "📷",
  video: "🎥",
  audio: "🎵",
  document: "📄",
  sticker: "🧩",
};

/**
 * A small glyph representing the media bucket, used in the attachment chip.
 *
 * @param {MediaType} type
 * @returns {string}
 */
export function mediaEmoji(type) {
  return MEDIA_EMOJI[type] || "📎";
}

const MEDIA_LABEL = {
  image: "Photo",
  video: "Video",
  audio: "Audio",
  document: "Document",
  sticker: "Sticker",
};

/**
 * A short noun for a media bucket, used when a message has no caption.
 *
 * @param {MediaType} type
 * @returns {string}
 */
export function mediaLabel(type) {
  return MEDIA_LABEL[type] || "Attachment";
}
