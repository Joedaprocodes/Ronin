import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { eventsUrl } from "@/lib/api";

/**
 * Live inbox updates over Server-Sent Events.
 *
 * One EventSource is shared by the whole app (browsers cap concurrent
 * connections per host). If the backend doesn't expose GET /api/events yet —
 * or the network drops it — we retry with backoff a few times and then give
 * up, leaving every screen on its normal manual-refresh behaviour. Nothing
 * throws; the app simply doesn't receive live frames.
 */
const InboxEventsContext = createContext(null);

const MAX_FAILURES = 3;
const BASE_RETRY_MS = 3000;
const MAX_RETRY_MS = 30000;

export function InboxEventsProvider({ children }) {
  const listenersRef = useRef(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") {
      return undefined;
    }

    let source = null;
    let failures = 0;
    let retryTimer = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      if (source) return; // already connected or scheduled
      source = new EventSource(eventsUrl());

      source.onopen = () => {
        failures = 0;
        setConnected(true);
      };

      source.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return; // ignore keep-alive comments / malformed frames
        }
        for (const listener of listenersRef.current) {
          try {
            listener(payload);
          } catch {
            // one broken listener must not stop the rest
          }
        }
      };

      source.onerror = () => {
        setConnected(false);
        source?.close();
        source = null;
        if (cancelled || failures >= MAX_FAILURES) return;
        const delay = Math.min(BASE_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
        failures += 1;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, delay);
      };
    }

    // Coming back online after an offline stretch: reset the failure counter
    // (which may have been exhausted while offline) and reconnect.
    function handleOnline() {
      failures = 0;
      clearTimeout(retryTimer);
      if (!source) connect();
    }
    window.addEventListener("online", handleOnline);

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener("online", handleOnline);
      source?.close();
      source = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      connected,
      subscribe(listener) {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
    }),
    [connected]
  );

  return (
    <InboxEventsContext.Provider value={value}>
      {children}
    </InboxEventsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInboxEvents() {
  return useContext(InboxEventsContext);
}

/**
 * Subscribe to live inbox events. The handler always sees the latest closure
 * (kept in a ref) and the subscription is cleaned up on unmount. Safe to call
 * outside the provider: it simply never fires.
 *
 * @param {(payload: {jid?: string, message?: import("@/lib/api").MessageView}) => void} handler
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useInboxEventsListener(handler) {
  const events = useContext(InboxEventsContext);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!events) return undefined;
    return events.subscribe((payload) => handlerRef.current?.(payload));
  }, [events]);
}
