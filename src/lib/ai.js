import { mediaLabel } from "@/lib/media";

/**
 * AI replies, drafted by Google's Gemini API.
 *
 * The API key is kept in this browser (Settings → AI replies) rather than on
 * the backend, so every request goes straight from the tab to Google's
 * Generative Language API. The key is therefore only as private as the device
 * it is saved on: keep it scoped to the Gemini API and rotate it if it leaks.
 */

/** localStorage key holding `{ enabled, apiKey, model }`. */
export const AI_SETTINGS_KEY = "ai-settings";

/** Where a key can be minted. */
export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

/**
 * The default model, used until someone types their own in Settings. Flash Lite
 * is the cheapest, fastest tier and is plenty for short reply drafts.
 */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

/**
 * Model ids this project previously shipped as the default. A device that saved
 * settings before the default changed kept the old id in localStorage without
 * ever choosing it, so these map to the current default on load. Any other
 * stored model is treated as a deliberate choice and left alone.
 */
const RETIRED_DEFAULT_MODELS = ["gemini-3.8-flash"];

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** How many messages of history, and how much text, the prompt carries. */
const TRANSCRIPT_MESSAGES = 20;
const TRANSCRIPT_CHARS = 4000;
const MESSAGE_CHARS = 400;

/**
 * @typedef {Object} AiSettings
 * @property {boolean} enabled - master switch (hidden when off)
 * @property {string} apiKey
 * @property {string} model
 */

/** @type {AiSettings} */
export const DEFAULT_AI_SETTINGS = {
  enabled: true,
  apiKey: "",
  model: DEFAULT_MODEL,
};

/**
 * The tones offered in the composer picker. `prompt` steers the model; `hint`
 * is the one-liner shown under the label.
 * @typedef {Object} AiTone
 * @property {string} id
 * @property {string} label
 * @property {string} emoji
 * @property {string} hint
 * @property {string} prompt
 */

/** @type {AiTone[]} */
export const TONES = [
  {
    id: "friendly",
    label: "Friendly",
    emoji: "😊",
    hint: "Warm and easy-going",
    prompt: "warm, upbeat and easy-going, like texting a friend you like.",
  },
  {
    id: "professional",
    label: "Professional",
    emoji: "💼",
    hint: "Polite and businesslike",
    prompt: "polite, clear and businesslike, while still sounding human.",
  },
  {
    id: "casual",
    label: "Casual",
    emoji: "😎",
    hint: "Relaxed, everyday speech",
    prompt: "relaxed and colloquial, the way friends actually text.",
  },
  {
    id: "flirty",
    label: "Flirty",
    emoji: "💘",
    hint: "Playful and charming",
    prompt:
      "playful and charming, with light teasing and warmth. Keep it tasteful.",
  },
  {
    id: "funny",
    label: "Funny",
    emoji: "😂",
    hint: "Light and witty",
    prompt: "light and witty — land a small joke or a clever turn of phrase.",
  },
  {
    id: "direct",
    label: "Short & direct",
    emoji: "⚡",
    hint: "One line, no filler",
    prompt:
      "short and to the point — one sentence, no filler, no pleasantries.",
  },
  {
    id: "empathetic",
    label: "Empathetic",
    emoji: "🤗",
    hint: "Warm and understanding",
    prompt:
      "warm and understanding — acknowledge how they feel before replying.",
  },
  {
    id: "apologetic",
    label: "Apologetic",
    emoji: "🙏",
    hint: "Sincere and accountable",
    prompt:
      "sincere and accountable — own the mistake plainly and offer to make it right.",
  },
];

/**
 * Read the saved AI settings, falling back to the defaults for anything
 * missing or malformed (a blocked/unavailable localStorage included).
 *
 * @returns {AiSettings}
 */
export function loadAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_AI_SETTINGS };
    }
    const stored = typeof parsed.model === "string" ? parsed.model.trim() : "";
    return {
      enabled: parsed.enabled !== false,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model:
        stored && !RETIRED_DEFAULT_MODELS.includes(stored)
          ? stored
          : DEFAULT_MODEL,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/**
 * Merge a partial update into the saved settings.
 *
 * @param {Partial<AiSettings>} patch
 * @returns {AiSettings} the settings after the write
 */
export function saveAiSettings(patch) {
  const next = { ...loadAiSettings(), ...patch };
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the change applies for this session only.
  }
  return next;
}

/**
 * A message as it appears in the transcript sent to the model. Media messages
 * are described by their bucket so the model knows something was sent.
 *
 * @param {import("@/lib/api").MessageView} message
 * @returns {string}
 */
function describeMessage(message) {
  let body = (message.text ?? "").trim();
  if (body.length > MESSAGE_CHARS) body = `${body.slice(0, MESSAGE_CHARS)}…`;
  if (!body && message.media) body = `[${mediaLabel(message.media.type)}]`;
  if (!body) return "";

  const quoted = (message.quoted?.text ?? "").trim();
  if (quoted) body = `(replying to: "${quoted.slice(0, 160)}") ${body}`;
  return body;
}

/**
 * The most recent stretch of the conversation, newest-last, as plain lines.
 *
 * @param {import("@/lib/api").MessageView[]} messages
 * @param {string} contactName
 * @returns {string}
 */
function buildTranscript(messages, contactName) {
  const lines = [];
  let budget = TRANSCRIPT_CHARS;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (lines.length >= TRANSCRIPT_MESSAGES) break;
    const message = messages[i];
    if (!message || message.deleted || message.system) continue;

    const body = describeMessage(message);
    if (!body) continue;

    const who = message.from === "me" ? "You" : contactName;
    const line = `${who}: ${body}`;
    if (line.length > budget) break;

    budget -= line.length + 1;
    lines.push(line);
  }

  return lines.reverse().join("\n");
}

/**
 * The system prompt: who is writing, in which tone, and the hard rules that
 * keep the output paste-ready.
 *
 * @param {AiTone} tone
 * @param {string} contactName
 * @returns {string}
 */
function systemInstruction(tone, contactName) {
  return [
    `You draft WhatsApp messages that the user sends as themselves. In the transcript "You" is the user and "${contactName}" is the other person.`,
    `Write the reply in a ${tone.label.toLowerCase()} tone: ${tone.prompt}`,
    "",
    "Rules:",
    "- Output only the message text: no quotes, no labels or prefixes, no markdown.",
    "- Keep it short and natural — one to three sentences, like a real text message.",
    "- Match the language and any code-switching used in the conversation.",
    "- Reply to the latest message; never invent facts, plans, prices or promises.",
    "- Never mention that you are an AI.",
  ].join("\n");
}

/**
 * Pull the message text out of a `generateContent` response, dropping any
 * thinking parts and the stray quotes or prefixes models sometimes add.
 *
 * @param {any} data
 * @returns {string}
 */
function cleanReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const text = parts
    .filter((part) => part?.text && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text) return "";

  let reply = text;
  const fenced = reply.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) reply = fenced[1].trim();

  reply = reply.replace(/^(you|me)\s*:\s*/i, "");
  if (
    reply.length > 1 &&
    ((reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith("“") && reply.endsWith("”")) ||
      (reply.startsWith("'") && reply.endsWith("'")))
  ) {
    reply = reply.slice(1, -1).trim();
  }

  return reply;
}

/**
 * A human-readable reason for a failed request.
 *
 * @param {number} status
 * @param {string} detail - the API's own error message, when there is one
 * @param {string} model
 * @returns {string}
 */
function reasonFor(status, detail, model) {
  if (
    status === 401 ||
    status === 403 ||
    /api key not valid|api_key_invalid|permission denied/i.test(detail)
  ) {
    return "That Gemini API key was rejected — check it in Settings";
  }
  if (status === 404) {
    return `Gemini doesn't know the model "${model}" — check it in Settings`;
  }
  if (status === 429) {
    return "Gemini rate limit reached — try again in a moment";
  }
  if (status >= 500) return "Gemini is having a moment — try again shortly";
  return detail || `Gemini request failed (${status})`;
}

/**
 * The `error.message` of a failed response, or "" when there is no JSON body.
 *
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function errorDetail(res) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? "";
}

/**
 * One `generateContent` request.
 *
 * @param {string} apiKey
 * @param {string} model
 * @param {any} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
async function sendGenerate(apiKey, model, body, signal) {
  try {
    return await fetch(
      `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal,
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    // An abort is the caller's own doing (popover closed, unmounted).
    if (err?.name === "AbortError") throw err;
    throw new Error("Couldn't reach Gemini — check your connection", {
      cause: err,
    });
  }
}

/**
 * Ask Gemini for a reply to the latest messages, in the requested tone.
 *
 * @param {{
 *   tone: AiTone,
 *   messages: import("@/lib/api").MessageView[],
 *   conversation?: { name?: string } | null,
 *   draft?: string,
 *   signal?: AbortSignal,
 * }} options - `draft` is whatever the user has already typed; when present
 *   it is treated as the intent and only finished off.
 * @returns {Promise<string>} the reply text, ready to drop into the composer
 */
export async function generateReply({
  tone,
  messages,
  conversation,
  draft = "",
  signal,
}) {
  const { apiKey, model } = loadAiSettings();
  if (!apiKey) throw new Error("Add your Gemini API key in Settings first");

  const contactName = conversation?.name?.trim() || "the contact";
  const transcript = buildTranscript(messages ?? [], contactName);
  const started = draft.trim();
  const prompt = started
    ? `The user started typing this and wants it finished:\n"""${started}"""\n\nConversation:\n${transcript}`
    : `Conversation:\n${transcript}`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction(tone, contactName) }],
    },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 400,
      // Replies should be quick: the low thinking level trims the latency on
      // the 3.x Flash models, which can't turn thinking fully off.
      thinkingConfig: { thinkingLevel: "low" },
    },
  };

  let res = await sendGenerate(apiKey, model, body, signal);

  if (res.status === 400) {
    const detail = await errorDetail(res);
    // Older API surfaces reject the unknown `thinkingConfig` field: drop it and
    // try once more rather than failing the whole request.
    if (/thinking/i.test(detail)) {
      delete body.generationConfig.thinkingConfig;
      res = await sendGenerate(apiKey, model, body, signal);
    } else {
      throw new Error(reasonFor(400, detail, model));
    }
  }

  if (!res.ok) {
    throw new Error(reasonFor(res.status, await errorDetail(res), model));
  }

  const data = await res.json().catch(() => null);
  const reply = cleanReply(data);
  if (!reply) throw new Error("Gemini didn't return a reply — try again");
  return reply;
}

