/**
 * Helpers for turning a chat message into a broadcast template. Kept free of
 * React and of the media helpers so the string handling can be unit-tested
 * (there is no frontend test runner, but `lib/` stays framework-free).
 */

/**
 * Whether a stored message can become a template: it needs content to copy and
 * must not be a delete tombstone or a group membership notice.
 *
 * @param {import("@/lib/api").MessageView} [message]
 * @returns {boolean}
 */
export function canMakeTemplate(message) {
  return Boolean(
    message && !message.deleted && !message.system && (message.text || message.media)
  );
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A name specific enough to swap for a placeholder without mangling text. */
function usableName(name) {
  const trimmed = (name ?? "").trim();
  return trimmed.length >= 2 && /\p{L}/u.test(trimmed);
}

/**
 * Replace whole-word occurrences of `word` with `token`, case-insensitively.
 * Uses a leading capture group rather than lookbehind, which older iOS Safari
 * doesn't support.
 */
function swapWord(text, word, token) {
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
    "giu"
  );
  return text.replace(pattern, (_, lead) => `${lead}${token}`);
}

/**
 * Whether the text mentions the contact by name — used to decide whether
 * offering to personalise it is worth it.
 *
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function mentionsName(text, name) {
  if (!usableName(name) || !text) return false;
  const first = name.trim().replace(/\s+/g, " ").split(" ")[0];
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(first)}(?![\\p{L}\\p{N}])`,
    "iu"
  ).test(text);
}

/**
 * Turn the contact's name into the broadcast placeholders so a broadcast can
 * personalise it: the full name becomes {{full_name}} and the first name
 * {{name}}.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
export function personaliseName(text, name) {
  const full = (name ?? "").trim().replace(/\s+/g, " ");
  if (!usableName(full)) return text;
  const parts = full.split(" ");
  if (parts.length === 1) return swapWord(text, parts[0], "{{name}}");
  const withFull = text.replace(
    new RegExp(escapeRegExp(full), "gi"),
    "{{full_name}}"
  );
  return swapWord(withFull, parts[0], "{{name}}");
}

/** Put the contact's name back, undoing {@link personaliseName}. */
export function restoreName(text, name) {
  const full = (name ?? "").trim().replace(/\s+/g, " ");
  if (!usableName(full)) return text;
  return text
    .replace(/\{\{\s*full_name\s*\}\}/gi, full)
    .replace(/\{\{\s*name\s*\}\}/gi, full.split(" ")[0]);
}
