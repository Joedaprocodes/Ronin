export { cn } from "cn"

/**
 * Group raw digits as an international-looking number, e.g. "2348146858279"
 * -> "+234 814 685 8279". Digits are grouped in threes, folding a trailing
 * lone digit into the previous group (never a stray one-digit group). Returns
 * "" when there are no digits.
 *
 * @param {string} [value]
 * @returns {string}
 */
export function formatDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";

  const groups = [];
  for (let i = 0; i < digits.length; i += 3) {
    groups.push(digits.slice(i, i + 3));
  }
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop();
    groups[groups.length - 1] += last;
  }
  return `+${groups.join(" ")}`;
}

/**
 * Format a WhatsApp account id for display.
 *
 * Only personal JIDs (`<digits>@s.whatsapp.net`) are turned into a phone
 * number; anything else (groups, status broadcast, …) is returned unchanged.
 * A multi-device suffix (`2348146858279:11@s.whatsapp.net`) is dropped first.
 *
 * @param {string} [id]
 * @returns {string}
 */
export function formatPhone(id) {
  if (!id) return "";
  if (!id.endsWith("@s.whatsapp.net")) return id;

  // Drop the "@s.whatsapp.net" domain, then the ":<device>" multi-device suffix.
  const number = id.slice(0, id.lastIndexOf("@")).split(":")[0];
  return formatDigits(number) || id;
}

/** Country code assumed when a number is typed without one (Nigeria). */
export const DEFAULT_COUNTRY_CODE = "234";

/**
 * Canonicalize a phone number to `+<country><national>`, assuming the default
 * country code when the input doesn't already carry one.
 *
 *   2348052928072   -> +2348052928072   (already has the code, no "+")
 *   08052928072     -> +2348052928072   (local; trunk 0 dropped)
 *   8052928072      -> +2348052928072   (bare national number)
 *   +2348052928072  -> +2348052928072   (already international)
 *
 * A leading "+" always wins, so foreign numbers are respected as entered.
 * Numbers that carry a *different* country code without a "+" can't be told
 * apart from a national number and get the default prefix — include "+" to be
 * explicit. Returns "" when there are no digits.
 *
 * @param {string} [value]
 * @param {string} [countryCode] digits only, e.g. "234"
 * @returns {string}
 */
export function normalizePhone(value, countryCode = DEFAULT_COUNTRY_CODE) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  // An explicit "+" means the number is already in international form; drop a
  // stray trunk zero ("+0…" isn't a valid country code).
  if (raw.startsWith("+")) return `+${digits.replace(/^0+/, "") || digits}`;

  const cc = String(countryCode ?? "").replace(/\D/g, "");
  if (!cc) return `+${digits}`;

  // Local format: a single trunk 0, replaced by the country code.
  if (digits.startsWith("0")) return `+${cc}${digits.replace(/^0+/, "")}`;

  // Already prefixed with the country code.
  if (digits.startsWith(cc)) return `+${digits}`;

  return `+${cc}${digits}`;
}

/**
 * Keep 1–4 digits from a typed country code, falling back to the default when
 * nothing usable remains.
 *
 * @param {string} [value]
 * @returns {string}
 */
export function sanitizeCountryCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  return digits || DEFAULT_COUNTRY_CODE;
}

