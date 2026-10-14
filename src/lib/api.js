export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Resolve a media path returned by the API into an absolute URL.
 * Absolute/http(s), data: and blob: values are passed through untouched.
 *
 * @param {string} [path]
 * @returns {string}
 */
export function mediaUrl(path) {
  if (!path) return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * The Server-Sent Events endpoint for live inbox updates.
 *
 * EventSource cannot send request headers, so the API token (when set) is
 * passed as a `?token=` query parameter — the backend accepts it either way.
 *
 * @returns {string}
 */
export function eventsUrl() {
  const token = import.meta.env.VITE_API_TOKEN;
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const qs = params.toString();
  return `${API_URL}/api/events${qs ? `?${qs}` : ""}`;
}

/**
 * Small fetch wrapper for the backend API.
 * Throws an Error (with the server's message when available) on non-2xx.
 */
export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // no JSON body; keep the generic status message
    }
    const error = new Error(message);
    // Lets callers react to specific statuses (e.g. a 404 → "not found").
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Fetch the inbox conversation list.
 *
 * With a non-empty `q` the search runs server-side (GET /api/inbox?q=) over
 * the resolved contact name and every message's text, so it also matches
 * phrases older than a chat's last message.
 *
 * @param {string} [q] search phrase (trimmed before sending)
 * @returns {Promise<import("@/screens/InboxScreen").Conversation[]>}
 */
export async function listConversations(q = "") {
  const params = new URLSearchParams();
  if (typeof q === "string" && q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  const data = await apiFetch(`/api/inbox${qs ? `?${qs}` : ""}`);
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

/**
 * The linked WhatsApp account (who is sending on this server).
 *
 * Throws on the 503 a server started without a connection returns (apiFetch
 * does that for non-2xx).
 *
 * @returns {Promise<{ok: boolean, connected: boolean, state: string,
 *   user: {id: string, name: string | null} | null}>}
 */
export async function fetchAccount() {
  return apiFetch("/api/account");
}

/** The API token header for account writes (empty object when unset). */
function accountTokenHeader() {
  const token = import.meta.env.VITE_API_TOKEN;
  return token ? { "x-api-token": token } : {};
}

/**
 * Unlink the linked WhatsApp device. Logs the session out and wipes the stored
 * credentials; the server then relinks and advertises a fresh QR / pairing
 * code. Idempotent — safe to call when already disconnected.
 *
 * @returns {Promise<{ok: boolean, connected: boolean, state: string}>}
 */
export async function disconnectAccount() {
  return apiFetch("/api/account/disconnect", {
    method: "POST",
    headers: accountTokenHeader(),
  });
}

/**
 * Permanently delete all backend app data: every row (messages, chats,
 * contacts, lists, templates, broadcasts, guards, automation) plus the stored
 * media bytes. The linked WhatsApp device stays connected — use
 * {@link disconnectAccount} to unlink.
 *
 * @returns {Promise<{ok: boolean, mediaRemoved: number}>}
 */
export async function clearBackendData() {
  return apiFetch("/api/account/clear-data", {
    method: "POST",
    headers: accountTokenHeader(),
  });
}

/**
 * Request an 8-character pairing code (e.g. "ABCD-EFGH") to link a phone.
 *
 * @param {string} [phoneNumber] the account's own number, digits with country
 *   code; falls back to the server's configured `PHONE_NUMBER` when omitted
 * @returns {Promise<{ok: boolean, code: string, expiresInMs: number}>}
 */
export async function requestPairingCode(phoneNumber) {
  return apiFetch("/api/account/pair", {
    method: "POST",
    headers: accountTokenHeader(),
    body: JSON.stringify(phoneNumber ? { phoneNumber } : {}),
  });
}

/**
 * @typedef {Object} ThreadPage
 * @property {import("@/screens/ConversationScreen").Conversation | null} conversation
 * @property {MessageView[]} messages - the page, ascending by time
 * @property {boolean} hasMore - whether older messages exist
 * @property {string | null} nextBefore - cursor for the next older page
 */

/**
 * Fetch one page of a thread.
 *
 * Degrades gracefully: backends without pagination support return the full
 * thread and omit `hasMore`/`nextBefore`, which yields a single page with no
 * "load older" in the UI.
 *
 * @param {string} jid
 * @param {{limit?: number, before?: string}} [options]
 * @returns {Promise<ThreadPage>}
 */
export async function fetchThreadPage(jid, { limit, before } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const qs = params.toString();

  const data = await apiFetch(
    `/api/inbox/${encodeURIComponent(jid)}${qs ? `?${qs}` : ""}`
  );
  const conversation = data?.conversation ?? null;
  const messages = Array.isArray(conversation?.messages)
    ? conversation.messages
    : [];

  return {
    conversation,
    messages,
    hasMore: Boolean(data?.hasMore),
    nextBefore: data?.nextBefore ?? null,
  };
}

/**
 * @typedef {Object} SendMedia
 * @property {"image"|"video"|"audio"|"document"|"sticker"} type
 * @property {string} data - base64 bytes or a full data: URL
 * @property {string} [mimeType]
 * @property {string} [fileName]
 * @property {string} [caption]
 */

/**
 * @typedef {Object} SendInput
 * @property {string} [text]
 * @property {string} [email]
 * @property {SendMedia} [media]
 * @property {string} [quotedId] - id of a stored message in this chat to send
 *   as a quoted reply
 */

/**
 * A media attachment on a stored message, served by the backend.
 * @typedef {Object} MessageMedia
 * @property {"image"|"video"|"audio"|"document"|"sticker"} type
 * @property {string} [mimeType]
 * @property {string} [fileName]
 * @property {string} url - path served by GET /api/media/:id
 */

/**
 * The message a reply quotes, as shown in the quote block. `media` is the
 * bucket only (rendered as an icon + label); the bytes are never fetched.
 * `sender` is present only in group chats ("You" for our own quotes).
 * @typedef {Object} QuotedMessage
 * @property {string|null} id - the quoted message's id (jump target)
 * @property {string} text
 * @property {{ type: "image"|"video"|"audio"|"document"|"sticker" }} [media]
 * @property {string} [sender]
 */

/**
 * One reaction left on a message.
 * @typedef {Object} MessageReaction
 * @property {string} text - the emoji
 * @property {"me"|"them"} from
 * @property {string} [sender] - who reacted (only in group chats)
 */

/**
 * A group membership notice, rendered as a centered system line.
 * @typedef {Object} SystemEvent
 * @property {"add"|"remove"|"promote"|"demote"} action
 * @property {string} [actor] - the bare jid of whoever made the change
 * @property {string[]} [participants] - bare jids of the members affected
 */

/**
 * A message as returned by the inbox API.
 * @typedef {Object} MessageView
 * @property {string} id
 * @property {"me"|"them"} from
 * @property {string} [sender]
 * @property {string} text
 * @property {string} time
 * @property {MessageMedia} [media]
 * @property {QuotedMessage} [quoted]
 * @property {boolean} [deleted] - the message was deleted (a tombstone; `text`/`media`/`quoted` are still sent so an admin can reveal them)
 * @property {boolean} [edited] - the message's text was edited after sending
 * @property {MessageReaction[]} [reactions] - reactions on this message (absent when there are none)
 * @property {SystemEvent} [system] - a group membership notice; `text` is the rendered line
 */

/**
 * Send a message to the given JID.
 *
 * When the backend can echo the persisted row (a newer server), `message` is
 * the stored MessageView so the caller can render it optimistically; older
 * servers simply omit it and callers fall back to refetching the thread.
 *
 * @param {string} jid
 * @param {SendInput} input
 * @returns {Promise<{ok: boolean, id?: string, message?: MessageView, status?: number, error?: string, data?: any}>}
 */
export async function sendMessage(jid, input) {
  const baseUrl = API_URL;
  const token = import.meta.env.VITE_API_TOKEN;

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "x-api-token": token } : {}),
  };

  try {
    const res = await fetch(
      `${baseUrl}/api/inbox/${encodeURIComponent(jid)}/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(input || {}),
      }
    );

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // `message` is the persisted row when the backend supports it; once it
      // lands, the UI can show the sent message without waiting for a refetch.
      return { ok: true, id: data?.id, message: data?.message, data };
    }

    let serverError = "";
    try {
      const body = await res.json();
      if (body?.error) serverError = body.error;
    } catch {
      // ignore
    }

    let error = serverError || `Request failed (${res.status})`;
    if (res.status === 401) {
      error = "Not authorized to send (token missing or wrong)";
    } else if (res.status === 409) {
      error = "WhatsApp is not connected";
    } else if (res.status === 413) {
      error = "File is too large (max 20 MB)";
    } else if (res.status === 422) {
      error = "This number isn't on WhatsApp";
    } else if (res.status === 400 || res.status === 502) {
      error = serverError || error;
    }

    return { ok: false, status: res.status, error };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.message || "Network error",
    };
  }
}

/**
 * Edit one of our own messages (text only). The backend echoes the refreshed
 * row so the caller can update the bubble in place.
 *
 * @param {string} jid
 * @param {string} id
 * @param {string} text
 * @returns {Promise<{ok: boolean, message?: MessageView, status?: number, error?: string}>}
 */
export async function editMessage(jid, id, text) {
  return messageWrite(jid, id, "PUT", { text: text ?? "" });
}

/**
 * Delete (revoke) one of our own messages. WhatsApp keeps a tombstone; the
 * backend returns the updated row so the bubble can switch to it immediately.
 *
 * @param {string} jid
 * @param {string} id
 * @returns {Promise<{ok: boolean, message?: MessageView, status?: number, error?: string}>}
 */
export async function deleteMessage(jid, id) {
  return messageWrite(jid, id, "DELETE");
}

/**
 * Add or clear our reaction on a message. Unlike edit/delete this works on any
 * (non-deleted) message, matching WhatsApp; an empty `text` removes ours.
 *
 * @param {string} jid
 * @param {string} id
 * @param {string} text - the emoji; "" (or falsy) clears our reaction
 * @returns {Promise<{ok: boolean, message?: MessageView, status?: number, error?: string}>}
 */
export async function sendReaction(jid, id, text) {
  return messageWrite(jid, id, "POST", { text: text ?? "" }, "reaction");
}

/**
 * Shared PUT/POST/DELETE request for a single message, with the same friendly
 * error mapping as the other write endpoints.
 *
 * @param {string} jid
 * @param {string} id
 * @param {"PUT"|"DELETE"|"POST"} method
 * @param {object} [body]
 * @param {string} [suffix] - extra path segment ("reaction")
 * @returns {Promise<{ok: boolean, message?: MessageView, status?: number, error?: string, data?: any}>}
 */
async function messageWrite(jid, id, method, body, suffix = "") {
  const token = import.meta.env.VITE_API_TOKEN;
  const headers = {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "x-api-token": token } : {}),
  };

  try {
    const res = await fetch(
      `${API_URL}/api/inbox/${encodeURIComponent(jid)}/messages/${encodeURIComponent(id)}${
        suffix ? `/${suffix}` : ""
      }`,
      { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }
    );
    const data = await res.json().catch(() => ({}));

    if (res.ok) return { ok: true, message: data?.message, data };

    let error = data?.error || `Request failed (${res.status})`;
    if (res.status === 401) {
      error = "Not authorized (token missing or wrong)";
    } else if (res.status === 403) {
      error = suffix
        ? "You can't react to this message"
        : "You can only edit or delete your own messages";
    } else if (res.status === 404) {
      error = "This message is no longer available";
    } else if (res.status === 409) {
      error = data?.error || "WhatsApp is not connected";
    } else if (res.status === 400 || res.status === 502) {
      error = data?.error || error;
    }

    return { ok: false, status: res.status, error };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || "Network error" };
  }
}

/**
 * A saved broadcast template.
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {string} [fallbackName] - substituted for {{name}}/{{full_name}} when a contact has no name
 * @property {MessageMedia} [media] - present only when the template has an attachment
 * @property {string} createdAt
 */

/**
 * The writable shape of a template. `media` follows the PUT semantics:
 * omitted = keep the existing attachment, null = clear it, object = replace/add.
 * @typedef {Object} TemplateInput
 * @property {string} title
 * @property {string} [body]
 * @property {string} [fallbackName]
 * @property {SendMedia | null} [media]
 */

/**
 * All templates, newest first.
 * @returns {Promise<Template[]>}
 */
export async function listTemplates() {
  const data = await apiFetch("/api/templates");
  return Array.isArray(data?.templates) ? data.templates : [];
}

/**
 * One template. Throws on a 404 (the thrown Error carries `.status`).
 * @param {string} id
 * @returns {Promise<Template | null>}
 */
export async function getTemplate(id) {
  const data = await apiFetch(`/api/templates/${encodeURIComponent(id)}`);
  return data?.template ?? null;
}

/**
 * Create a template.
 * @param {TemplateInput} input
 * @returns {Promise<Template | null>}
 */
export async function createTemplate(input) {
  const data = await apiFetch("/api/templates", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  return data?.template ?? null;
}

/**
 * Update a template. Omit `media` to keep the existing attachment, pass null to
 * clear it, or a SendMedia object to replace it.
 * @param {string} id
 * @param {TemplateInput} input
 * @returns {Promise<Template | null>}
 */
export async function updateTemplate(id, input) {
  const data = await apiFetch(`/api/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input ?? {}),
  });
  return data?.template ?? null;
}

/**
 * Delete a template.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deleteTemplate(id) {
  return apiFetch(`/api/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/*  Contacts                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A saved contact. `phone` is stored in E.164-ish form (leading +, digits).
 * @typedef {Object} Contact
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 * @property {string} createdAt
 */

/**
 * The writable shape of a contact.
 * @typedef {Object} ContactInput
 * @property {string} name
 * @property {string} phone
 */

/**
 * One skipped import row, as reported by the backend.
 * @typedef {Object} ImportSkip
 * @property {string} [phone]
 * @property {string} reason
 */

/**
 * Result of a bulk contact import.
 * @typedef {Object} ImportResult
 * @property {number} imported
 * @property {ImportSkip[]} skipped
 */

/**
 * All contacts, optionally filtered server-side by name/number.
 * @param {string} [q]
 * @returns {Promise<Contact[]>}
 */
export async function listContacts(q = "") {
  const params = new URLSearchParams();
  if (typeof q === "string" && q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  const data = await apiFetch(`/api/contacts${qs ? `?${qs}` : ""}`);
  return Array.isArray(data?.contacts) ? data.contacts : [];
}

/**
 * One contact. Throws on a 404 (the thrown Error carries `.status`).
 * @param {string} id
 * @returns {Promise<Contact | null>}
 */
export async function getContact(id) {
  const data = await apiFetch(`/api/contacts/${encodeURIComponent(id)}`);
  return data?.contact ?? null;
}

/**
 * Create a contact.
 * @param {ContactInput} input
 * @returns {Promise<Contact | null>}
 */
export async function createContact(input) {
  const data = await apiFetch("/api/contacts", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  return data?.contact ?? null;
}

/**
 * Update a contact.
 * @param {string} id
 * @param {ContactInput} input
 * @returns {Promise<Contact | null>}
 */
export async function updateContact(id, input) {
  const data = await apiFetch(`/api/contacts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input ?? {}),
  });
  return data?.contact ?? null;
}

/**
 * Delete a contact.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deleteContact(id) {
  return apiFetch(`/api/contacts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * Bulk-delete contacts. Lists are kept; their memberships are dropped.
 * @param {string[]} ids
 * @returns {Promise<number>} how many contacts existed and were deleted
 */
export async function deleteContacts(ids) {
  const data = await apiFetch("/api/contacts/delete", {
    method: "POST",
    body: JSON.stringify({ ids: ids ?? [] }),
  });
  return Number(data?.deleted) || 0;
}

/**
 * All broadcast lists that contain the given contact, newest first.
 * @param {string} id contact id
 * @returns {Promise<BroadcastList[]>}
 */
export async function listContactLists(id) {
  const data = await apiFetch(`/api/contacts/${encodeURIComponent(id)}/lists`);
  return Array.isArray(data?.lists) ? data.lists : [];
}

/**
 * Bulk-import contacts (already parsed into rows by the caller).
 * @param {ContactInput[]} contacts
 * @returns {Promise<ImportResult>}
 */
export async function importContacts(contacts) {
  const data = await apiFetch("/api/contacts/import", {
    method: "POST",
    body: JSON.stringify({ contacts: contacts ?? [] }),
  });
  return {
    imported: Number(data?.imported) || 0,
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  };
}

/* -------------------------------------------------------------------------- */
/*  Broadcast lists (audiences)                                               */
/* -------------------------------------------------------------------------- */

/**
 * A named set of contacts that a broadcast can target.
 * @typedef {Object} BroadcastList
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} memberCount
 * @property {string} createdAt
 */

/**
 * A list together with its member ids (returned by getList).
 * @typedef {BroadcastList & { contactIds: string[] }} BroadcastListDetail
 */

/**
 * The writable shape of a list. `contactIds` replaces the membership.
 * @typedef {Object} BroadcastListInput
 * @property {string} name
 * @property {string} [description]
 * @property {string[]} [contactIds]
 */

/**
 * All broadcast lists, newest first.
 * @returns {Promise<BroadcastList[]>}
 */
export async function listLists() {
  const data = await apiFetch("/api/lists");
  return Array.isArray(data?.lists) ? data.lists : [];
}

/**
 * One list, including its member ids. Throws on a 404.
 * @param {string} id
 * @returns {Promise<BroadcastListDetail | null>}
 */
export async function getList(id) {
  const data = await apiFetch(`/api/lists/${encodeURIComponent(id)}`);
  return data?.list ?? null;
}

/**
 * Create a broadcast list.
 * @param {BroadcastListInput} input
 * @returns {Promise<BroadcastList | null>}
 */
export async function createList(input) {
  const data = await apiFetch("/api/lists", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  return data?.list ?? null;
}

/**
 * Update a list (rename, re-describe, and/or replace its members).
 * @param {string} id
 * @param {BroadcastListInput} input
 * @returns {Promise<BroadcastList | null>}
 */
export async function updateList(id, input) {
  const data = await apiFetch(`/api/lists/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input ?? {}),
  });
  return data?.list ?? null;
}

/**
 * Delete a list. Contacts themselves are not deleted.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deleteList(id) {
  return apiFetch(`/api/lists/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/*  Broadcasts                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A broadcast job as returned by the API.
 * @typedef {Object} Broadcast
 * @property {string} id
 * @property {string} templateId
 * @property {string} [templateTitle]
 * @property {string[]} listIds
 * @property {string | null} [senderEmail]
 * @property {number} minDelay
 * @property {number} maxDelay
 * @property {string | null} sendAt - null when it sends immediately
 * @property {"sending"|"scheduled"|"done"|"failed"} status
 * @property {number} total - deduped recipient count
 * @property {number} sent
 * @property {number} failed
 * @property {string} createdAt
 * @property {string | null} [startedAt]
 * @property {string | null} [finishedAt]
 * @property {string | null} [error]
 */

/**
 * One recipient of a broadcast, from getBroadcast.
 * @typedef {Object} BroadcastRecipient
 * @property {string} phone
 * @property {string} [name]
 * @property {"pending"|"sent"|"failed"} status
 * @property {string | null} [error]
 * @property {string | null} [sentAt]
 */

/**
 * The writable shape of a broadcast send.
 * @typedef {Object} BroadcastInput
 * @property {string} templateId
 * @property {string[]} listIds
 * @property {number} [minDelay]
 * @property {number} [maxDelay]
 * @property {string | null} [sendAt] - ISO-8601, or null to send now
 * @property {string | null} [senderEmail]
 */

/**
 * Send (or schedule) a broadcast.
 *
 * Mirrors `sendMessage`: the API token (when configured) rides in the
 * `x-api-token` header and failures come back as `{ ok: false, status, error }`
 * rather than a throw, so the screen can surface a human-readable message.
 *
 * @param {BroadcastInput} input
 * @returns {Promise<{ok: boolean, broadcast?: Broadcast | null, status?: number, error?: string}>}
 */
export async function sendBroadcast(input) {
  const token = import.meta.env.VITE_API_TOKEN;

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "x-api-token": token } : {}),
  };

  try {
    const res = await fetch(`${API_URL}/api/broadcasts/send`, {
      method: "POST",
      headers,
      body: JSON.stringify(input || {}),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, broadcast: data?.broadcast ?? null };
    }

    let serverError = "";
    try {
      const body = await res.json();
      if (body?.error) serverError = body.error;
    } catch {
      // ignore
    }

    let error = serverError || `Request failed (${res.status})`;
    if (res.status === 401) {
      error = "Not authorized to send (token missing or wrong)";
    } else if (res.status === 404) {
      error = serverError || "The template or list no longer exists";
    } else if (res.status === 409) {
      error = "WhatsApp is not connected";
    } else if (res.status === 413) {
      error = "Too many recipients (max 5000)";
    } else if (res.status === 502) {
      error = "The template's media couldn't be read";
    } else if (res.status === 503) {
      error = "The server isn't ready to send yet";
    } else if (res.status === 400) {
      error = serverError || "Check the template, audience and delays";
    }

    return { ok: false, status: res.status, error };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || "Network error" };
  }
}

/**
 * Recent broadcasts, newest first. Throws on a non-2xx (the Error carries
 * `.status`).
 * @returns {Promise<Broadcast[]>}
 */
export async function getBroadcasts() {
  const data = await apiFetch("/api/broadcasts");
  return Array.isArray(data?.broadcasts) ? data.broadcasts : [];
}

/**
 * One broadcast with its recipients. Throws on a 404.
 * @param {string} id
 * @returns {Promise<{broadcast: Broadcast | null, recipients: BroadcastRecipient[]}>}
 */
export async function getBroadcast(id) {
  const data = await apiFetch(`/api/broadcasts/${encodeURIComponent(id)}`);
  return {
    broadcast: data?.broadcast ?? null,
    recipients: Array.isArray(data?.recipients) ? data.recipients : [],
  };
}

/* -------------------------------------------------------------------------- */
/*  Groups                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One member of a group, from GET /api/groups/:jid.
 * @typedef {Object} GroupParticipant
 * @property {string} id - canonical jid (may be @lid or @s.whatsapp.net)
 * @property {string | null} name - best display name, or null
 * @property {string | null} username - @username, or null
 * @property {string | null} phone - digits, or null
 * @property {"admin" | "superadmin" | null} admin
 */

/**
 * A group's metadata, served from the backend's persisted snapshot. While
 * WhatsApp is connected the snapshot is kept current from socket events, so it
 * is normally fresh; `participants` is [] when the backend can't list them
 * (display rule: name ?? username ?? phone ?? id).
 * @typedef {Object} GroupInfo
 * @property {string} jid
 * @property {string | null} name - group subject
 * @property {string | null} description
 * @property {string | null} owner - creator's canonical jid
 * @property {string | null} ownerPn - creator's phone jid
 * @property {string | null} createdAt - ISO-8601
 * @property {number} size
 * @property {boolean} announce - true when only admins can message
 * @property {boolean} restrict - true when only admins can edit info
 * @property {boolean} isCommunity
 * @property {number | null} ephemeralDuration - disappearing messages (seconds)
 * @property {GroupParticipant[]} participants
 * @property {boolean} [stale] - true when served offline/after a failed refresh
 * @property {string | null} [fetchedAt] - ISO-8601 of the last live snapshot
 */

/**
 * Fetch a group's metadata from the backend snapshot.
 *
 * Throws (the Error carries `.status`) so the screen can branch:
 *   503 no WhatsApp connection configured, 409 socket not connected,
 *   404 group not found, 502 metadata could not be read.
 *
 * The response may carry `stale: true` with a `fetchedAt` timestamp when the
 * socket is offline (or a live refresh failed) and the backend served its last
 * stored snapshot instead.
 *
 * @param {string} jid
 * @returns {Promise<GroupInfo | null>}
 */
export async function getGroupInfo(jid) {
  const data = await apiFetch(`/api/groups/${encodeURIComponent(jid)}`);
  return data?.group ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Guards (per-group auto-moderation)                                        */
/* -------------------------------------------------------------------------- */

/**
 * A group offered for guard configuration. Only groups where the linked
 * account is an admin are returned.
 * @typedef {Object} GuardGroup
 * @property {string} jid
 * @property {string | null} name
 * @property {number} memberCount
 * @property {boolean} guarded - true when settings have been saved for it
 */

/**
 * Per-group guard settings, mirroring the backend shape. Strike thresholds are
 * numbers; `warnTemplate` empty means the server default applies.
 * @typedef {Object} GuardSettings
 * @property {boolean} linkGuard
 * @property {boolean} toxicityGuard
 * @property {boolean} blockExternal
 * @property {boolean} blockInvites
 * @property {string[]} linkWhitelist - bare allowed hosts
 * @property {"low" | "medium" | "strict"} sensitivity
 * @property {string} warnTemplate
 * @property {number} warnAt
 * @property {number} kickAt
 */

/**
 * One moderation-log entry.
 * @typedef {Object} ModerationEntry
 * @property {string} id
 * @property {string} jid
 * @property {string | null} user - the member's display name
 * @property {string | null} actorJid
 * @property {"Deleted" | "Warned" | "Kicked"} action
 * @property {string} reason
 * @property {string | null} detail
 * @property {string} time - ISO-8601
 */

/**
 * Groups where the linked account is an admin (the only configurable ones).
 *
 * Throws (the Error carries `.status`) so the screen can branch:
 *   503 no WhatsApp connection configured, 409 socket not connected.
 *
 * @returns {Promise<GuardGroup[]>}
 */
export async function listGuardGroups() {
  const data = await apiFetch("/api/guards");
  return Array.isArray(data?.groups) ? data.groups : [];
}

/**
 * Fetch one group's guard settings (merged over the server defaults).
 * @param {string} jid
 * @returns {Promise<GuardSettings | null>}
 */
export async function getGuardSettings(jid) {
  const data = await apiFetch(`/api/guards/${encodeURIComponent(jid)}`);
  return data?.settings ?? null;
}

/**
 * Save one group's guard settings. The API token (when configured) rides in the
 * `x-api-token` header, like the send helpers.
 * @param {string} jid
 * @param {GuardSettings} settings
 * @returns {Promise<GuardSettings | null>}
 */
export async function saveGuardSettings(jid, settings) {
  const token = import.meta.env.VITE_API_TOKEN;
  const data = await apiFetch(`/api/guards/${encodeURIComponent(jid)}`, {
    method: "PUT",
    headers: token ? { "x-api-token": token } : {},
    body: JSON.stringify(settings ?? {}),
  });
  return data?.settings ?? null;
}

/**
 * A group's recent moderation actions, newest first.
 * @param {string} jid
 * @param {{ limit?: number }} [options]
 * @returns {Promise<ModerationEntry[]>}
 */
export async function listModerationLog(jid, { limit } = {}) {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  const data = await apiFetch(
    `/api/guards/${encodeURIComponent(jid)}/log${qs}`
  );
  return Array.isArray(data?.entries) ? data.entries : [];
}

/* -------------------------------------------------------------------------- */
/*  Automation (auto-replies + away mode)                                     */
/* -------------------------------------------------------------------------- */

/** The API token header for automation writes (empty object when unset). */
function automationTokenHeader() {
  const token = import.meta.env.VITE_API_TOKEN;
  return token ? { "x-api-token": token } : {};
}

/**
 * An auto-reply rule. The reply content is always a broadcast template
 * (`templateId`), shared with the Broadcasts screen.
 * @typedef {Object} AutoReplyRule
 * @property {string} id
 * @property {string} keyword
 * @property {"contains" | "exact"} match
 * @property {string | null} templateId
 * @property {boolean} enabled
 * @property {boolean} dm - reply in direct messages
 * @property {boolean} quote - send the reply as a quoted reply to the trigger
 * @property {string[]} groups - group jids to reply in
 * @property {string} [createdAt]
 */

/**
 * The writable shape of an auto-reply rule.
 * @typedef {Object} AutoReplyRuleInput
 * @property {string} keyword
 * @property {"contains" | "exact"} [match]
 * @property {string} templateId
 * @property {boolean} [enabled]
 * @property {boolean} [dm]
 * @property {boolean} [quote]
 * @property {string[]} [groups]
 */

/**
 * Away-mode settings. `start`/`end` are "HH:MM" (local to `timeZone`); an empty
 * `timeZone` means the server's zone. A template is required while enabled.
 * @typedef {Object} AwaySettings
 * @property {boolean} enabled
 * @property {string} start
 * @property {string} end
 * @property {string | null} templateId
 * @property {boolean} oncePerContact
 * @property {boolean} quote - send the away reply as a quoted reply to the trigger
 * @property {string} timeZone - IANA zone, e.g. "Africa/Lagos"
 * @property {string | null} [updatedAt]
 */

/**
 * A group offered as an auto-reply scope. Unlike guard groups these are every
 * group the account is in (replying needs no admin rights).
 * @typedef {Object} AutomationGroup
 * @property {string} jid
 * @property {string | null} name
 * @property {number} memberCount
 */

/**
 * All auto-reply rules, oldest first (evaluation order).
 * @returns {Promise<AutoReplyRule[]>}
 */
export async function listAutoReplies() {
  const data = await apiFetch("/api/automation/replies");
  return Array.isArray(data?.rules) ? data.rules : [];
}

/**
 * Create an auto-reply rule.
 * @param {AutoReplyRuleInput} input
 * @returns {Promise<AutoReplyRule | null>}
 */
export async function createAutoReply(input) {
  const data = await apiFetch("/api/automation/replies", {
    method: "POST",
    headers: automationTokenHeader(),
    body: JSON.stringify(input ?? {}),
  });
  return data?.rule ?? null;
}

/**
 * Update an auto-reply rule. Omitted fields keep their current value.
 * @param {string} id
 * @param {Partial<AutoReplyRuleInput>} patch
 * @returns {Promise<AutoReplyRule | null>}
 */
export async function updateAutoReply(id, patch) {
  const data = await apiFetch(`/api/automation/replies/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: automationTokenHeader(),
    body: JSON.stringify(patch ?? {}),
  });
  return data?.rule ?? null;
}

/**
 * Delete an auto-reply rule.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deleteAutoReply(id) {
  return apiFetch(`/api/automation/replies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: automationTokenHeader(),
  });
}

/**
 * Read away-mode settings (merged over the server defaults).
 * @returns {Promise<AwaySettings | null>}
 */
export async function getAwaySettings() {
  const data = await apiFetch("/api/automation/away");
  return data?.away ?? null;
}

/**
 * Save away-mode settings. Omitted fields keep their current value.
 * @param {Partial<AwaySettings>} settings
 * @returns {Promise<AwaySettings | null>}
 */
export async function saveAwaySettings(settings) {
  const data = await apiFetch("/api/automation/away", {
    method: "PUT",
    headers: automationTokenHeader(),
    body: JSON.stringify(settings ?? {}),
  });
  return data?.away ?? null;
}

/**
 * Groups available as auto-reply scopes.
 *
 * Throws (the Error carries `.status`) so the screen can branch:
 *   503 no WhatsApp connection configured, 409 socket not connected,
 *   502 group metadata could not be read.
 *
 * @returns {Promise<AutomationGroup[]>}
 */
export async function listAutomationGroups() {
  const data = await apiFetch("/api/automation/groups");
  return Array.isArray(data?.groups) ? data.groups : [];
}
