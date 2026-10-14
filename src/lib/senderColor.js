/**
 * Per-participant name colors for group chats.
 *
 * WhatsApp gives every group member a color for their name so a busy thread is
 * easy to scan. There's no color in the message payload — we derive one from a
 * stable identity (the participant's display name) with a tiny deterministic
 * hash, so the same person keeps the same color across messages and reloads.
 *
 * The palette is a fixed set of Tailwind text classes with a light and a dark
 * variant, chosen to keep enough contrast on the muted bubble in both themes.
 */
const PALETTE = [
  "text-rose-600 dark:text-rose-400",
  "text-orange-600 dark:text-orange-400",
  "text-amber-600 dark:text-amber-400",
  "text-lime-600 dark:text-lime-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-teal-600 dark:text-teal-400",
  "text-sky-600 dark:text-sky-400",
  "text-indigo-600 dark:text-indigo-400",
  "text-violet-600 dark:text-violet-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
];

/**
 * A stable color class for a participant, derived from their identity.
 *
 * @param {string} [identity] - the participant's display name (or id)
 * @returns {string} Tailwind text-color classes (light + dark)
 */
export function senderColor(identity) {
  const key = String(identity ?? "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    // 31-based rolling hash, kept in 32-bit range to stay deterministic.
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
