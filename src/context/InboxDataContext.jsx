import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch, fetchThreadPage, listConversations } from "@/lib/api";
import {
  getConversations,
  persist,
  putConversations,
  putThreadPage,
} from "@/lib/idb";
import { useInboxEventsListener } from "@/context/InboxEventsContext";

/**
 * App-wide inbox data: the conversation list, its loading/error state, and the
 * derived unread/flagged counts.
 *
 * The Inbox screen and the nav badge both read from here, so marking a chat as
 * read clears the badge immediately and a live SSE frame updates both at once —
 * one fetch, no duplicate polling.
 *
 * Read path is offline-first (stale-while-revalidate): the IndexedDB cache is
 * shown instantly (and works offline), then the network refreshes it and the
 * fresh list is written back.
 *
 * The provider is only mounted while a user is signed in (see InboxDataBoundary
 * in App.jsx) and is remounted per signed-in user via its `key`, so a sign-out
 * automatically discards a previous session's data with no reset bookkeeping.
 */
const InboxDataContext = createContext(null);

// Coalesce a burst of stream events into a single list refresh.
const LIVE_REFRESH_MS = 400;

// Threads only enter the IndexedDB cache by being opened, so the newest few are
// prefetched in the background to keep them readable offline. Bounded, and each
// chat is attempted at most once per session (see warmThreads).
const WARM_THREADS = 10;
const WARM_PAGE_SIZE = 50;

// Used by screens that mount outside the provider (e.g. while signed out).
const EMPTY_CONTEXT = {
  conversations: [],
  loading: false,
  error: null,
  refresh: async () => [],
  markRead: () => {},
  setFlagged: () => {},
  unreadCount: 0,
  flaggedCount: 0,
};

export function InboxDataProvider({ children }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);

  // Chats whose thread we have already tried to warm this session, so that the
  // refresh path (visibility changes, SSE bursts) can never become a fetch loop.
  const warmedRef = useRef(new Set());

  /**
   * Warm the thread cache for the newest chats so tapping one while offline
   * shows its messages instead of an empty error. Best-effort and silent: this
   * never blocks or fails the inbox, and each chat is tried at most once per
   * session (a chat that fails to warm simply loads on demand, as before).
   */
  const warmThreads = useCallback((list) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    for (const chat of list.slice(0, WARM_THREADS)) {
      const jid = chat?.id ?? chat?.jid;
      if (!jid || warmedRef.current.has(jid)) continue;
      warmedRef.current.add(jid);
      fetchThreadPage(jid, { limit: WARM_PAGE_SIZE })
        .then((page) => putThreadPage(jid, page))
        .catch(() => {});
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
      setError(null);
      putConversations(list).catch(() => {});
      warmThreads(list);
      return list;
    } catch (err) {
      setError(err);
      return null;
    }
  }, [warmThreads]);

  // Initial load: render the cache immediately, then revalidate from the
  // network. The provider remounts whenever the signed-in user changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Cache first — show saved conversations instantly (offline-safe).
      let cached = [];
      let hasCache = false;
      try {
        cached = await getConversations();
        hasCache = cached.length > 0;
      } catch {
        // cache unavailable (private mode, quota) — fall through to network
      }
      if (cancelled) return;

      if (hasCache) {
        setConversations(cached);
        setError(null);
        setLoading(false);
      }

      // 2. Network revalidation (stale-while-revalidate).
      try {
        const list = await listConversations();
        if (cancelled) return;
        setConversations(list);
        setError(null);
        putConversations(list).catch(() => {});
        warmThreads(list);
      } catch (err) {
        if (cancelled) return;
        // Keep the cached list; the error only shows in the empty state.
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [warmThreads]);

  // Ask the browser to keep our storage (once; nothing depends on the result).
  useEffect(() => {
    persist().catch(() => {});
  }, []);

  // Refresh when the tab becomes visible again (no polling).
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      refresh();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [refresh]);

  // Live updates: coalesce stream events into a single refresh so a burst of
  // messages doesn't hammer the API.
  useInboxEventsListener(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, LIVE_REFRESH_MS);
  });

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const markRead = useCallback((id) => {
    // Optimistic: clear the badge instantly, then persist server-side.
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );

    apiFetch(`/api/inbox/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }).catch(() => {
      // Ignore failures: the badge stays cleared ("seen on open").
    });

    // Keep the offline cache consistent too (best-effort).
    getConversations()
      .then((list) => {
        const match = list.find((c) => c.id === id);
        if (match) putConversations([{ ...match, unread: 0 }]).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const setFlagged = useCallback((id, flagged) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, flagged } : c))
    );

    apiFetch(`/api/inbox/${encodeURIComponent(id)}/flag`, {
      method: "POST",
      body: JSON.stringify({ flagged }),
    }).catch(() => {
      // Ignore failures: keep the optimistic value.
    });

    getConversations()
      .then((list) => {
        const match = list.find((c) => c.id === id);
        if (match) putConversations([{ ...match, flagged }]).catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Total unread messages across every chat — the nav badge number.
  const unreadCount = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
    [conversations]
  );
  const flaggedCount = useMemo(
    () => conversations.filter((c) => c.flagged).length,
    [conversations]
  );

  const value = useMemo(
    () => ({
      conversations,
      loading,
      error,
      refresh,
      markRead,
      setFlagged,
      unreadCount,
      flaggedCount,
    }),
    [
      conversations,
      loading,
      error,
      refresh,
      markRead,
      setFlagged,
      unreadCount,
      flaggedCount,
    ]
  );

  return (
    <InboxDataContext.Provider value={value}>
      {children}
    </InboxDataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInboxData() {
  // Falls back to empty/no-op data when no provider is mounted (e.g. while
  // signed out), so callers like the nav in Shell never need to special-case it.
  return useContext(InboxDataContext) ?? EMPTY_CONTEXT;
}