import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInboxPreferences } from "@/context/InboxPreferencesContext";

const OPTIONS = [
  { value: "all", label: "All conversations" },
  { value: "unread", label: "Unread" },
  { value: "flagged", label: "Flagged" },
];

/** Settings control: choose which tab the inbox opens to. Drop inside a Card. */
export default function InboxDefaultTabSetting() {
  const { defaultTab, setDefaultTab } = useInboxPreferences();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label htmlFor="default-inbox-tab" className="flex-1">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Default inbox tab</span>
          <span className="text-xs font-normal text-muted-foreground">
            Which view the inbox opens to.
          </span>
        </span>
      </Label>
      <Select value={defaultTab} onValueChange={setDefaultTab}>
        <SelectTrigger id="default-inbox-tab" className="w-40 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
