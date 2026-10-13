import { useEffect, useState } from "react";

/**
 * Live network status (navigator.onLine + online/offline events).
 * Defaults to online where navigator is unavailable.
 *
 * @returns {boolean}
 */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    function handleChange() {
      setOnline(navigator.onLine);
    }

    window.addEventListener("online", handleChange);
    window.addEventListener("offline", handleChange);
    return () => {
      window.removeEventListener("online", handleChange);
      window.removeEventListener("offline", handleChange);
    };
  }, []);

  return online;
}