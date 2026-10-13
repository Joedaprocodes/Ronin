import { useState } from "react";
import { Input } from "@/components/ui/input";
import { sanitizeCountryCode } from "@/lib/utils";
import { usePhonePreferences } from "@/context/PhonePreferencesContext";

const MAX_DIGITS = 4;

/**
 * Editable country-code field bound to the shared phone preference, so every
 * place that uses it (import, the contact editor, Settings) stays in step.
 * Accepts a little slack while typing — the committed value is always 1–4
 * digits (or the default). Pass through any Input props via `...props`.
 */
export default function CountryCodeInput({ className, disabled = false, ...props }) {
  const { countryCode, setCountryCode } = usePhonePreferences();
  const [value, setValue] = useState(countryCode);

  function handleChange(next) {
    const digits = next.replace(/\D/g, "").slice(0, MAX_DIGITS);
    setValue(digits);
    // Keep an empty field while typing; the stored code only updates once
    // there's at least one digit.
    if (digits) setCountryCode(digits);
  }

  function handleBlur() {
    // Never leave the field blank — fall back to the stored/default code.
    const next = sanitizeCountryCode(value);
    setValue(next);
    setCountryCode(next);
  }

  return (
    <Input
      {...props}
      inputMode="numeric"
      autoComplete="tel-country-code"
      placeholder="234"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      className={className}
    />
  );
}
