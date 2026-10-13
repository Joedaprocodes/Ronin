import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createContact as createContactApi,
  createList as createListApi,
  deleteContact as deleteContactApi,
  deleteContacts as deleteContactsApi,
  deleteList as deleteListApi,
  importContacts as importContactsApi,
  listContacts,
  listLists,
  updateContact as updateContactApi,
  updateList as updateListApi,
} from "@/lib/api";

/**
 * App-wide contacts and broadcast lists.
 *
 * The Contacts screen and the Broadcasts audiences card both read from here, so
 * a list created on one screen shows up as a selectable audience on the other
 * without a refetch. The provider is mounted only while a user is signed in
 * (see the boundary in App.jsx) and is remounted per user, so signing out
 * discards the previous session's data automatically.
 *
 * Unlike the inbox, there is no offline cache: contacts/lists are read-only
 * data that the server always has the latest copy of.
 */
const ContactsDataContext = createContext(null);

// Used by screens that mount outside the provider (e.g. while signed out).
const EMPTY_CONTEXT = {
  contacts: [],
  lists: [],
  loading: false,
  error: null,
  refresh: async () => {},
  createContact: async () => null,
  updateContact: async () => null,
  deleteContact: async () => {},
  deleteContacts: async () => 0,
  importContacts: async () => ({ imported: 0, skipped: [] }),
  createList: async () => null,
  updateList: async () => null,
  deleteList: async () => {},
};

export function ContactsDataProvider({ children }) {
  const [contacts, setContacts] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch both collections, without touching state (so callers can decide how
  // to apply the result and whether a loading flag should flip).
  const load = useCallback(async () => {
    const [nextContacts, nextLists] = await Promise.all([
      listContacts(),
      listLists(),
    ]);
    return { contacts: nextContacts, lists: nextLists };
  }, []);

  const apply = useCallback((data) => {
    setContacts(data.contacts);
    setLists(data.lists);
    setError(null);
  }, []);

  // Initial load. State is only set from inside the async IIFE (never
  // synchronously in the effect body), keeping the hooks lint rule happy.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        apply(data);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load, apply]);

  // Re-fetch everything, showing the loading state (used by "Try again").
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      apply(await load());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [load, apply]);

  const createContact = useCallback(async (input) => {
    const created = await createContactApi(input);
    if (created) setContacts((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateContact = useCallback(async (id, input) => {
    const updated = await updateContactApi(id, input);
    if (updated) {
      setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    }
    return updated;
  }, []);

  const deleteContact = useCallback(async (id) => {
    await deleteContactApi(id);
    // Lists may have counted this contact; drop the row now and let the next
    // refresh reconcile each list's memberCount.
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const deleteContacts = useCallback(async (ids) => {
    const deleted = await deleteContactsApi(ids);
    const gone = new Set(ids);
    setContacts((prev) => prev.filter((c) => !gone.has(c.id)));
    // Memberships changed, so list counts changed; reconcile them.
    try {
      const nextLists = await listLists();
      setLists(nextLists);
    } catch {
      // keep current lists; counts reconcile on the next refresh
    }
    return deleted;
  }, []);

  const importContacts = useCallback(
    async (rows) => {
      const result = await importContactsApi(rows);
      // Pull the newly added rows in (best-effort — the contacts tab already
      // shows what was imported from the API's own response).
      try {
        apply(await load());
      } catch {
        // keep whatever we already have
      }
      return result;
    },
    [load, apply]
  );

  const createList = useCallback(async (input) => {
    const created = await createListApi(input);
    if (created) setLists((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateList = useCallback(async (id, input) => {
    const updated = await updateListApi(id, input);
    if (updated) {
      setLists((prev) => prev.map((l) => (l.id === id ? updated : l)));
    }
    return updated;
  }, []);

  const deleteList = useCallback(async (id) => {
    await deleteListApi(id);
    setLists((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      contacts,
      lists,
      loading,
      error,
      refresh,
      createContact,
      updateContact,
      deleteContact,
      deleteContacts,
      importContacts,
      createList,
      updateList,
      deleteList,
    }),
    [
      contacts,
      lists,
      loading,
      error,
      refresh,
      createContact,
      updateContact,
      deleteContact,
      deleteContacts,
      importContacts,
      createList,
      updateList,
      deleteList,
    ]
  );

  return (
    <ContactsDataContext.Provider value={value}>
      {children}
    </ContactsDataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useContactsData() {
  // Falls back to empty/no-op data when no provider is mounted (e.g. while
  // signed out), so callers never need to special-case it.
  return useContext(ContactsDataContext) ?? EMPTY_CONTEXT;
}
