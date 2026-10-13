import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnline } from "@/hooks/useOnline";

/**
 * Compact connection indicator for the screen header.
 *
 * A green wifi icon while online, an amber wifi-off icon while the browser
 * reports the network is down. The explanatory text lives in the tooltip and
 * aria-label instead of a banner that takes up screen space.
 */
export default function ConnectionStatus({ className }) {
  const online = useOnline();
  const Icon = online ? Wifi : WifiOff;

  return (
    <span
      role="status"
      aria-label={online ? "Online" : "Offline"}
      title={
        online
          ? "Online"
          : "Offline — showing saved conversations. Messages will arrive when you reconnect."
      }
      className={cn(
        "flex size-9 shrink-0 items-center justify-center",
        online ? "text-emerald-500" : "text-amber-500",
        className
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </span>
  );
}
