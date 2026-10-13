import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_COUNTRY_CODE, sanitizeCountryCode } from "@/lib/utils";

/* Saved on this device: the country code applied to numbers typed without one. */
const STORAGE_KEY = "default-country-code";

const PhonePreferencesContext = createContext(null);

function getInitialCountryCode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return sanitizeCountryCode(saved);
  } catch {
    // storage unavailable, use the default
  }
  return DEFAULT_COUNTRY_CODE;
}

export function PhonePreferencesProvider({ children }) {
  const [countryCode, setCountryCodeState] = useState(getInitialCountryCode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, countryCode);
    } catch {
      // ignore: the choice still applies for this session
    }
  }, [countryCode]);

  const setCountryCode = (value) => setCountryCodeState(sanitizeCountryCode(value));

  return (
    <PhonePreferencesContext.Provider value={{ countryCode, setCountryCode }}>
      {children}
    </PhonePreferencesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePhonePreferences() {
  const context = useContext(PhonePreferencesContext);
  if (context === null) {
    throw new Error(
      "usePhonePreferences must be used within a PhonePreferencesProvider"
    );
  }
  return context;
}
