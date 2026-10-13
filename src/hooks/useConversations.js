import { useInboxData } from "@/context/InboxDataContext";

/**
 * The shared conversation list with an offline-first read path.
 *
 * Renders from the IndexedDB cache immediately (so the inbox works offline and
 * hydrates instantly), then revalidates from the network and writes the fresh
 * list back — stale-while-revalidate. Live SSE frames trigger the same cycle.
 *
 * Backed by <InboxDataProvider>, so the nav badge and the inbox screen always
 * show the same conversations without any duplicate fetching.
 */
export function useConversations() {
  const {
    conversations,
    loading,
    error,
    refresh,
    markRead,
    setFlagged,
  } = useInboxData();

  return { conversations, loading, error, refresh, markRead, setFlagged };
}