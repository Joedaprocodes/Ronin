import { createContext, useContext, useEffect, useState } from "react";

/* Saved on this device: which inbox tab the screen opens to. */
const STORAGE_KEY = "inbox-default-tab";
const DEFAULT_TABS = ["all", "unread", "flagged"];

const InboxPreferencesContext = createContext(null);

function getInitialDefaultTab() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (DEFAULT_TABS.includes(saved)) return saved;
  } catch {
    // storage unavailable, use the default
  }
  return "unread";
}

export function InboxPreferencesProvider({ children }) {
  const [defaultTab, setDefaultTab] = useState(getInitialDefaultTab);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, defaultTab);
    } catch {
      // ignore: the choice still applies for this session
    }
  }, [defaultTab]);

  return (
    <InboxPreferencesContext.Provider value={{ defaultTab, setDefaultTab }}>
      {children}
    </InboxPreferencesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInboxPreferences() {
  const context = useContext(InboxPreferencesContext);
  if (context === null) {
    throw new Error(
      "useInboxPreferences must be used within an InboxPreferencesProvider"
    );
  }
  return context;
}
