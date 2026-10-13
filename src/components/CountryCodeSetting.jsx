import { Label } from "@/components/ui/label";
import CountryCodeInput from "@/components/CountryCodeInput";

/** Settings control: the country code added to numbers entered without one. */
export default function CountryCodeSetting() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label htmlFor="default-country-code" className="flex-1">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Default country code</span>
          <span className="text-xs font-normal text-muted-foreground">
            Added to phone numbers entered without one.
          </span>
        </span>
      </Label>
      <CountryCodeInput
        id="default-country-code"
        aria-label="Default country code"
        className="w-24 shrink-0"
      />
    </div>
  );
}
