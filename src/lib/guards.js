/**
 * Shared, pure helpers for the Guards screen.
 *
 * The backend owns enforcement; this module only mirrors the settings shape so
 * the form can convert to/from the API payload, validate strike thresholds, and
 * preview the warning template. Keeping it dependency-free makes the tricky
 * bits (host normalization, token rendering) easy to reason about.
 */

/** Server-side defaults, mirrored so a fresh group renders sensibly. */
export const DEFAULT_GUARD_SETTINGS = {
  linkGuard: false,
  toxicityGuard: false,
  blockExternal: true,
  blockInvites: true,
  linkWhitelist: [],
  sensitivity: "medium",
  warnTemplate: "",
  warnAt: 2,
  kickAt: 5,
};

/** Used as a placeholder / preview when no custom template is set. */
export const DEFAULT_WARN_TEMPLATE =
  "⚠️ {name}, your message was removed ({reason}). Strike {strikes}/{kickAt}.";

/** The placeholder vocabulary the backend accepts (unknown tokens are rejected). */
export const WARN_TEMPLATE_TOKENS = [
  { token: "{name}", hint: "Sender's name" },
  { token: "{mention}", hint: "Tag the sender" },
  { token: "{strikes}", hint: "Current strike count" },
  { token: "{kickAt}", hint: "Kick threshold" },
  { token: "{reason}", hint: "Why it was removed" },
];

export const SENSITIVITY_LEVELS = [
  {
    id: "low",
    label: "Low",
    hint: "Only clear slurs and severe abuse are flagged.",
  },
  {
    id: "medium",
    label: "Medium",
    hint: "Common bad words and clearly hostile messages are flagged.",
  },
  {
    id: "strict",
    label: "Strict",
    hint: "Mild profanity and borderline messages are flagged too. Expect more false positives.",
  },
];

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Reduce pasted input to a bare hostname: strips scheme, userinfo, `www.`, the
 * port and any path/query/hash. Lowercased.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeHost(value) {
  let host = String(value ?? "").trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme://
  host = host.split(/[/?#]/)[0]; // path / query / hash
  host = host.split("@").pop(); // userinfo@
  host = host.replace(/^www\./, "");
  host = host.replace(/:\d+$/, ""); // :port
  return host;
}

/** Whether a normalized value is a plausible bare hostname. */
export function isValidHost(host) {
  return HOST.test(host);
}

/** Convert API settings into a form object (strike counts as strings). */
export function settingsToForm(settings) {
  const merged = { ...DEFAULT_GUARD_SETTINGS, ...(settings ?? {}) };
  return {
    ...merged,
    linkWhitelist: Array.isArray(merged.linkWhitelist)
      ? [...merged.linkWhitelist]
      : [],
    warnAt: String(merged.warnAt ?? ""),
    kickAt: String(merged.kickAt ?? ""),
  };
}

/** Convert a form object back into the API payload. */
export function formToPayload(form) {
  return {
    linkGuard: Boolean(form.linkGuard),
    toxicityGuard: Boolean(form.toxicityGuard),
    blockExternal: Boolean(form.blockExternal),
    blockInvites: Boolean(form.blockInvites),
    linkWhitelist: (form.linkWhitelist ?? [])
      .map(normalizeHost)
      .filter(isValidHost),
    sensitivity: form.sensitivity,
    warnTemplate: String(form.warnTemplate ?? "").trim(),
    warnAt: Number(form.warnAt),
    kickAt: Number(form.kickAt),
  };
}

/**
 * Validate the strike thresholds. Returns a human message, or null when valid.
 * @param {{warnAt: string, kickAt: string}} form
 */
export function validateGuardForm(form) {
  const warn = Number(form.warnAt);
  const kick = Number(form.kickAt);
  if (
    form.warnAt === "" ||
    form.kickAt === "" ||
    !Number.isInteger(warn) ||
    !Number.isInteger(kick) ||
    warn < 1 ||
    kick < 1
  ) {
    return "Strike counts must be whole numbers of 1 or more.";
  }
  if (kick <= warn) {
    return "Kick must come after warn (the kick strike must be higher).";
  }
  return null;
}

/**
 * Render a warning template for preview. Falls back to the default when empty
 * and leaves unknown tokens untouched (the backend rejects them on save).
 *
 * @param {string} template
 * @param {Record<string, string | number>} [context]
 */
export function renderWarnTemplate(template, context = {}) {
  const source = String(template ?? "").trim() || DEFAULT_WARN_TEMPLATE;
  return source.replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(context, token)
      ? String(context[token])
      : match
  );
}
