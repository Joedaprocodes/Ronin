import { useCallback, useEffect, useRef, useState } from "react";
import { fetchThreadPage } from "@/lib/api";
import {
  getConversation,
  getMeta,
  getThread,
  getThreadOlder,
  putConversations,
  putMessages,
  putThreadPage,
  threadCursorKey,
  threadOldestKey,
} from "@/lib/idb";
import { decodeCursor, encodeCursor } from "@/lib/cursors";
import { useInboxEventsListener } from "@/context/InboxEventsContext";
import { useOnline } from "@/hooks/useOnline";

/**
 * A pageable, offline-hydrated thread for one chat.
 *
 * Read path is stale-while-revalidate:
 * 1. newest `pageSize` messages hydrate from IndexedDB instantly (and work
 *    offline), including the persisted pagination cursor so "load older" works
 *    offline too;
 * 2. the newest page is then re-fetched from the network and merged (by id);
 * 3. every mutation (pages, live frames, sends) is written back to the cache.
 *
 * When the backend doesn't support pagination yet, `fetchThreadPage` returns
 * the whole thread with no `hasMore`, so the UI simply shows one page.
 *
 * A failed network load is only an error when there is nothing cached to show:
 * with cached messages the thread keeps rendering (the UI flags that it's
 * offline), which is what makes previously-opened chats readable offline.
 */
const DEFAULT_PAGE_SIZE = 50;

function byTimeThenId(a, b) {
  const byTime = (a.time || "").localeCompare(b.time || "");
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

/** Merge two message lists, dedupe by id, keep ascending (time, id) order. */
function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of existing || []) if (m) byId.set(m.id, m);
  for (const m of incoming || []) if (m?.id) byId.set(m.id, m);
  return [...byId.values()].sort(byTimeThenId);
}

const PAGE_META = (hasMore, nextBefore) => ({
  hasMore: hasMore === true && nextBefore != null,
  nextBefore: nextBefore ?? null,
});

/**
 * Page one older page out of the IndexedDB cache (the offline "load older"
 * fallback). Returns { messages, meta } so callers share the same merge +
 * persist path as the network path. Never throws; a broken cache behaves like
 * an exhausted one.
 */
async function pageOlderFromCache(jid, cursor, limit) {
  try {
    const older = await getThreadOlder(jid, cursor, limit);
    if (!older.length) return { messages: [], meta: PAGE_META(false, null) };

    const oldest = older[0];
    const nextBefore = encodeCursor(oldest.time, oldest.id);
    let hasMore = (await getThreadOlder(jid, nextBefore, 1)).length > 0;
    if (!hasMore) {
      // Safety net: the persisted oldest marker may still point below the
      // oldest message now shown (e.g. same-timestamp boundary rows), meaning
      // more cached rows exist even though a single next-page probe came back
      // empty. Compare the raw times/id (cursor strings are not ordered).
      const marker = await getMeta(threadOldestKey(jid));
      const parsed = decodeCursor(marker);
      if (parsed) {
        const exhausted =
          parsed.time > oldest.time ||
          (parsed.time === oldest.time && parsed.id >= oldest.id);
        hasMore = !exhausted;
      }
    }
    return {
      messages: older,
      meta: PAGE_META(hasMore, hasMore ? nextBefore : null),
    };
  } catch {
    return { messages: [], meta: PAGE_META(false, null) };
  }
}

/**
 * @param {string} jid
 * @param {{pageSize?: number}} [options]
 */
export function useThread(jid, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [state, setState] = useState({
    jid: null,
    conversation: null,
    messages: [],
    loading: true,
    error: null,
    hasMore: false,
    nextBefore: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  // Always the latest list, so async merges read current data.
  const messagesRef = useRef([]);
  const loadingMoreRef = useRef(false);

  const online = useOnline();

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  // Load the thread for the current jid. All state writes happen after an
  // await, so switching chats never flashes the previous chat's messages.
  useEffect(() => {
    if (!jid) return undefined;
    let cancelled = false;

    (async () => {
      // 1. Cache first.
      let cached = [];
      let cachedConversation;
      try {
        [cached, cachedConversation] = await Promise.all([
          getThread(jid, { limit: pageSize }),
          getConversation(jid),
        ]);
      } catch {
        // cache unavailable — fall through to the network
      }
      if (cancelled) return;

      const base = {
        jid,
        conversation: cachedConversation ?? null,
        messages: cached,
        loading: !cached.length && !cachedConversation,
        error: null,
        hasMore: false,
        nextBefore: null,
      };

      // 2. Restore the pagination cursor so offline "load older" still works.
      try {
        const cursor = await getMeta(threadCursorKey(jid));
        if (cursor) base.hasMore = cursor.hasMore === true && cursor.nextBefore != null;
        if (cursor) base.nextBefore = cursor.nextBefore ?? null;
      } catch {
        // ignore
      }
      if (cancelled) return;
      setState(base);

      // 3. Network revalidation (stale-while-revalidate).
      try {
        const page = await fetchThreadPage(jid, { limit: pageSize });
        if (cancelled) return;

        const merged = mergeMessages(base.messages, page.messages);
        const meta = PAGE_META(page.hasMore, page.nextBefore);
        setState({
          jid,
          conversation: page.conversation ?? base.conversation,
          messages: merged,
          loading: false,
          error: null,
          hasMore: meta.hasMore,
          nextBefore: meta.nextBefore,
        });

        // Persist the merged page: the messages, the pagination cursor and the
        // oldest-row marker (best-effort; see putThreadPage).
        putThreadPage(jid, {
          messages: merged,
          hasMore: meta.hasMore,
          nextBefore: meta.nextBefore,
        }).catch(() => {});
        if (page.conversation) putConversations([page.conversation]).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        // A 404 means this chat has no stored history yet (e.g. opening a chat
        // with a saved contact for the first time): show an empty thread so the
        // composer is usable instead of an error screen.
        if (err?.status === 404) {
          setState((prev) =>
            prev.jid === jid
              ? {
                  ...prev,
                  loading: false,
                  error: null,
                  hasMore: false,
                  nextBefore: null,
                }
              : prev
          );
          return;
        }
        // Offline or backend down. Keep whatever the cache gave us and stop the
        // spinner: this is only worth surfacing as an error when the screen
        // would otherwise be empty (no cached messages to fall back on).
        setState((prev) =>
          prev.jid === jid
            ? {
                ...prev,
                loading: false,
                error: prev.messages.length === 0 ? err : null,
              }
            : prev
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jid, pageSize]);

  /**
   * Fetch the next (older) page and prepend it, preserving scroll position.
   *
   * Online: the server's `before` cursor is used as-is. Offline (or when the
   * fetch fails), the page is read from the IndexedDB cache instead — cached
   * rows encode to the same cursors the server uses, so once back online the
   * network continues exactly where the cache left off.
   */
  const loadOlder = useCallback(async () => {
    const { nextBefore } = state;
    if (!jid || !nextBefore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setState((prev) => (prev.jid === jid ? { ...prev, error: null } : prev));

    try {
      let page = null;
      if (online) {
        try {
          page = await fetchThreadPage(jid, {
            limit: pageSize,
            before: nextBefore,
          });
        } catch {
          page = null; // fall through to the cache below
        }
      }

      if (page) {
        const merged = mergeMessages(messagesRef.current, page?.messages);
        const meta = PAGE_META(page?.hasMore, page?.nextBefore);

        setState((prev) =>
          prev.jid === jid
            ? {
                ...prev,
                conversation: page?.conversation ?? prev.conversation,
                messages: merged,
                hasMore: meta.hasMore,
                nextBefore: meta.nextBefore,
              }
            : prev
        );

        putThreadPage(jid, {
          messages: merged,
          hasMore: page?.hasMore,
          nextBefore: page?.nextBefore,
        }).catch(() => {});
      } else {
        // Offline / unreachable backend: page older rows from the cache.
        const cached = await pageOlderFromCache(jid, nextBefore, pageSize);
        const merged = mergeMessages(messagesRef.current, cached.messages);
        const meta = cached.meta;

        setState((prev) =>
          prev.jid === jid
            ? {
                ...prev,
                messages: merged,
                hasMore: meta.hasMore,
                nextBefore: meta.nextBefore,
                error: null,
              }
            : prev
        );

        putThreadPage(jid, {
          messages: merged,
          hasMore: meta.hasMore,
          nextBefore: meta.nextBefore,
        }).catch(() => {});
      }
    } catch (err) {
      // Not fatal: keep whatever is already loaded.
      setState((prev) => (prev.jid === jid ? { ...prev, error: err } : prev));
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [jid, pageSize, state, online]);

  /** Re-fetch the newest page and merge (e.g. after sending a message). */
  const refresh = useCallback(async () => {
    if (!jid) return;
    try {
      const page = await fetchThreadPage(jid, { limit: pageSize });

      const merged = mergeMessages(messagesRef.current, page?.messages);
      const meta = PAGE_META(page?.hasMore, page?.nextBefore);

      setState((prev) =>
        prev.jid === jid
          ? {
              ...prev,
              conversation: page?.conversation ?? prev.conversation,
              messages: merged,
              loading: false,
              error: null,
              hasMore: meta.hasMore,
              nextBefore: meta.nextBefore,
            }
          : prev
      );

      putThreadPage(jid, {
        messages: merged,
        hasMore: page?.hasMore,
        nextBefore: page?.nextBefore,
      }).catch(() => {});
    } catch (err) {
      // Background refresh failures are not fatal: a 404 just means the chat has
      // no history yet, and with cached messages on screen there is nothing to
      // report. Only surface an error when the thread would be left empty.
      setState((prev) =>
        prev.jid === jid
          ? {
              ...prev,
              error:
                err?.status === 404 || prev.messages.length > 0 ? null : err,
            }
          : prev
      );
    }
  }, [jid, pageSize]);

  /** Merge a single message in (live frames, optimistic sends). */
  const appendOptimistic = useCallback(
    (message) => {
      if (!message?.id) return;
      setState((prev) => ({
        ...prev,
        messages: mergeMessages(prev.messages, [message]),
      }));
      putMessages(jid, [message]).catch(() => {});
    },
    [jid]
  );

  /** Flip the flag on the locally-displayed conversation header. */
  const setConversationFlagged = useCallback(
    (flagged) => {
      setState((prev) =>
        prev.jid === jid && prev.conversation
          ? { ...prev, conversation: { ...prev.conversation, flagged } }
          : prev
      );
    },
    [jid]
  );

  // Live updates: merge frames for this chat (others are ignored).
  useInboxEventsListener((event) => {
    if (!event?.message || !jid) return;
    if (event.jid && event.jid !== jid) return;
    appendOptimistic(event.message);
  });

  const active = state.jid === jid;

  return {
    conversation: active ? state.conversation : null,
    messages: active ? state.messages : [],
    loading: !active || state.loading,
    error: active ? state.error : null,
    hasMore: active && state.hasMore,
    nextBefore: active ? state.nextBefore : null,
    loadingMore,
    loadOlder,
    refresh,
    appendOptimistic,
    setConversationFlagged,
  };
}