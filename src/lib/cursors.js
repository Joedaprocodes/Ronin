/**
 * Keyset cursors for thread pagination, mirroring the backend's contract
 * (whatsapp-pro2-server/src/db/inbox.js):
 *
 *   cursor = base64url(`${time}|${id}`)
 *
 * where `time` is the message view's exact `time` ISO string and `id` the
 * message id. Offline-generated cursors are byte-identical to what the server
 * produces, so cached pages and network pages interleave safely.
 *
 * Both sides compare strictly by `time` (iso-8601, UTC, fixed width), so
 * "before the cursor" is simply time < cursor.time.
 */

/**
 * @param {string} time the message's exact `time` ISO string
 * @param {string} id the message id (tiebreaker for equal timestamps)
 * @returns {string} the opaque base64url cursor
 */
export function encodeCursor(time, id) {
  if (typeof time !== "string" || !time || typeof id !== "string" || !id) {
    return "";
  }
  const bytes = new TextEncoder().encode(`${time}|${id}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a cursor back into { time, id }, or null when malformed.
 * @param {string} cursor
 * @returns {{time: string, id: string} | null}
 */
export function decodeCursor(cursor) {
  if (typeof cursor !== "string" || !cursor) return null;
  const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  let raw;
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    raw = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
  const sep = raw.lastIndexOf("|");
  if (sep <= 0 || sep === raw.length - 1) return null;
  const time = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!time || !id || Number.isNaN(new Date(time).getTime())) return null;
  return { time, id };
}