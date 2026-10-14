import * as idb from "./idb";
import { AI_SETTINGS_KEY } from "./ai";

/**
 * App-owned localStorage keys. Deliberately an allow-list: we never call
 * `localStorage.clear()` so the Supabase auth session (key
 * `sb-<ref>-auth-token`) and any other origin data are left intact.
 */
const LOCAL_KEYS = [
  "theme",
  "nav-position",
  "inbox-default-tab",
  "default-country-code",
  AI_SETTINGS_KEY,
];

/**
 * Wipe the locally cached app data: the offline IndexedDB cache (conversations,
 * messages, meta) and the app's own preference keys. The signed-in Supabase
 * session is preserved, as is the PWA/Service-Worker Cache Storage (an
 * app-shell cache rather than user data — clearing it under an active worker
 * risks breaking offline mode).
 *
 * Every step is best-effort so a locked-down browser (private mode, blocked
 * storage) still clears whatever it can.
 *
 * @returns {Promise<{stores: number, keys: number}>}
 */
export async function clearLocalData() {
  let stores = 0;
  try {
    stores = await idb.clearAll();
  } catch {
    // IndexedDB unavailable/blocked: nothing more to do here.
  }

  let keys = 0;
  try {
    for (const key of LOCAL_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        keys += 1;
      }
    }
  } catch {
    // storage disabled: nothing to remove
  }

  return { stores, keys };
}
