import { openDB } from "idb";
import { decodeCursor, encodeCursor } from "./cursors";

/**
 * Offline-first cache for inbox data, backed by IndexedDB.
 *
 * - `conversations`: one row per chat (keyPath `jid`, which equals the
 *   conversation id the API returns).
 * - `messages`: one row per message (keyPath `id`; stamped with a `chat` field
 *   so a thread is queryable, indexed by `chat` and `[chat, time]`).
 * - `meta`: small key/value rows (per-thread pagination cursors, timestamps).
 *
 * Every helper is best-effort: callers treat failures (private mode, quota,
 * unavailable storage) as a cache miss and fall back to the network.
 */
const DB_NAME = "whatsapp-pro2";
const DB_VERSION = 1;

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("chat", "chat");
        messages.createIndex("chat_time", ["chat", "time"]);
        db.createObjectStore("conversations", { keyPath: "jid" });
        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

function byLastActivity(a, b) {
  return (
    (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "") ||
    (b.time || "").localeCompare(a.time || "")
  );
}

/* ----------------------------- Conversations ----------------------------- */

/**
 * All cached conversations, newest activity first (the API's ordering).
 * @returns {Promise<import("@/screens/InboxScreen").Conversation[]>}
 */
export async function getConversations() {
  const db = await getDb();
  const list = await db.getAll("conversations");
  return list.sort(byLastActivity);
}

/**
 * Upsert conversations into the cache. Returns the number written.
 * @param {import("@/screens/InboxScreen").Conversation[]} list
 * @returns {Promise<number>}
 */
export async function putConversations(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction("conversations", "readwrite");
  await Promise.all([...list.map((c) => tx.store.put(c)), tx.done]);
  return list.length;
}

/**
 * A single cached conversation (matched by jid), or undefined.
 * @param {string} jid
 * @returns {Promise<import("@/screens/InboxScreen").Conversation | undefined>}
 */
export async function getConversation(jid) {
  const db = await getDb();
  return db.get("conversations", jid);
}

/* -------------------------------- Messages ------------------------------- */

/**
 * The newest `limit` cached messages of a chat, ascending by time.
 * @param {string} jid
 * @param {{limit?: number}} [options]
 * @returns {Promise<import("@/lib/api").MessageView[]>}
 */
export async function getThread(jid, { limit = 50 } = {}) {
  if (!jid) return [];
  const db = await getDb();
  const tx = db.transaction("messages", "readonly");
  const index = tx.store.index("chat_time");
  const range = IDBKeyRange.bound([jid, ""], [jid, "\uffff"]);

  const newest = [];
  let cursor = await index.openCursor(range, "prev");
  while (cursor && newest.length < limit) {
    newest.push(cursor.value);
    cursor = await cursor.continue();
  }
  return newest.reverse();
}

/**
 * Rows of a chat strictly older than `cursor`, newest-first, capped at
 * `limit`, returned ascending. Drives the offline "load older" fallback:
 * cached MessageView rows carry the exact `time` the server stores, so the
 * cursor derived from them is byte-identical to a server `nextBefore` and
 * network pages can resume right where the cache stopped (and vice-versa).
 *
 * The bound is by time only (time < cursor.time), covered by the existing
 * [chat, time] index — no schema or DB_VERSION change needed.
 *
 * @param {string} jid
 * @param {string} cursor an encodeCursor() cursor or a server `nextBefore`
 * @param {number} [limit]
 * @returns {Promise<import("@/lib/api").MessageView[]>}
 */
export async function getThreadOlder(jid, cursor, limit = 50) {
  if (!jid || !cursor) return [];
  const parsed = decodeCursor(cursor);
  if (!parsed) return [];
  const db = await getDb();
  const tx = db.transaction("messages", "readonly");
  const index = tx.store.index("chat_time");
  // Strictly below the cursor's time: [jid, ""] .. ([jid, cursor.time]) —
  // the upper bound is open so the boundary row itself is never re-served
  // (which could otherwise stall "load older" on a single-row cache).
  const range = IDBKeyRange.bound([jid, ""], [jid, parsed.time], false, true);

  const older = [];
  let cursorHandle = await index.openCursor(range, "prev"); // newest first
  while (cursorHandle && older.length < limit) {
    older.push(cursorHandle.value);
    cursorHandle = await cursorHandle.continue();
  }
  return older.reverse(); // ascending, ready to prepend
}

/**
 * The cursor of the oldest cached row of a chat, or null when the chat has no
 * cached messages. Persisted next to the pagination cursor so offline paging
 * can tell when the cache is exhausted even across reloads.
 * @param {string} jid
 * @returns {Promise<string | null>}
 */
export async function getThreadOldestCursor(jid) {
  if (!jid) return null;
  const db = await getDb();
  const tx = db.transaction("messages", "readonly");
  const index = tx.store.index("chat_time");
  const range = IDBKeyRange.bound([jid, ""], [jid, "\uffff"]);
  const cursorHandle = await index.openCursor(range, "next"); // oldest first
  if (!cursorHandle?.value) return null;
  const m = cursorHandle.value;
  if (!m.time || !m.id) return null;
  return encodeCursor(m.time, m.id);
}

/**
 * Upsert messages for a chat (dedupe by id). Returns the number written.
 * @param {string} jid
 * @param {import("@/lib/api").MessageView[]} messages
 * @returns {Promise<number>}
 */
export async function putMessages(jid, messages) {
  if (!jid || !Array.isArray(messages) || messages.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction("messages", "readwrite");
  await Promise.all([
    ...messages.map((m) => tx.store.put({ ...m, chat: jid })),
    tx.done,
  ]);
  return messages.length;
}

/**
 * Keep only the newest `keep` messages of a chat (deletes the rest).
 * @param {string} jid
 * @param {number} [keep]
 * @returns {Promise<number>} number of removed rows
 */
export async function pruneThread(jid, keep = 500) {
  if (!jid) return 0;
  const db = await getDb();
  const tx = db.transaction("messages", "readwrite");
  const index = tx.store.index("chat_time");
  const range = IDBKeyRange.bound([jid, ""], [jid, "\uffff"]);

  let seen = 0;
  let removed = 0;
  let cursor = await index.openCursor(range, "prev");
  while (cursor) {
    seen += 1;
    if (seen > keep) {
      cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

/* ---------------------------------- Meta --------------------------------- */

/**
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getMeta(key) {
  const db = await getDb();
  const row = await db.get("meta", key);
  return row?.value;
}

/**
 * @param {string} key
 * @param {any} value
 */
export async function putMeta(key, value) {
  const db = await getDb();
  await db.put("meta", { key, value });
}

/* ------------------------------- Storage --------------------------------- */

/**
 * Ask the browser to exempt our origin from automatic eviction.
 * @returns {Promise<boolean>} whether the request succeeded
 */
export async function persist() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<StorageEstimate | null>} usage/quota estimate, or null
 */
export async function estimate() {
  try {
    return (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}