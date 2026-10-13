import { useCallback, useEffect, useState } from "react";
import { fetchAccount } from "@/lib/api";

/**
 * The linked WhatsApp account, as reported by GET /api/account.
 *
 * Read-only (there is no revoke/logout endpoint). Failures — the 503 from a
 * server started without a connection, or a plain network error — degrade to
 * "disconnected" so the UI never crashes; `error` is kept for debugging only.
 *
 * Revalidates when the tab becomes visible again, matching the inbox's
 * visibility-refresh behaviour. No polling.
 *
 * @returns {{
 *   account: {id: string, name: string | null} | null,
 *   connected: boolean,
 *   state: string,
 *   loading: boolean,
 *   error: Error | null,
 *   refresh: () => void,
 * }}
 */
export function useAccount() {
  const [account, setAccount] = useState(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState("closed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchAccount();
        if (cancelled) return;
        setConnected(Boolean(data?.connected));
        setState(typeof data?.state === "string" ? data.state : "closed");
        setAccount(readUser(data));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Unconfigured server (503) or network error: show as disconnected.
        setConnected(false);
        setState("closed");
        setAccount(null);
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Revalidate when the tab becomes visible again (no polling).
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      refresh();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [refresh]);

  return { account, connected, state, loading, error, refresh };
}

/** A user is only present once a socket has actually opened. */
function readUser(data) {
  const user = data?.user;
  if (!user?.id) return null;
  return { id: user.id, name: user.name ?? null };
}
