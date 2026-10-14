import { useState } from "react";
import { Download, Loader2, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

/**
 * Settings control: install the app onto the device.
 *
 * Renders nothing when there is nothing useful to offer — the app is already
 * installed, or the browser neither fires `beforeinstallprompt` nor has a
 * manual install path we can describe. Drop inside a Card.
 */
export default function InstallAppSetting() {
  const { canInstall, isInstalled, isIos, promptInstall } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  if (isInstalled) return null;
  // iOS never fires `beforeinstallprompt`; the Share sheet is the only route.
  if (!canInstall && !isIos) return null;

  async function handleInstall() {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Install app</span>
        <span className="text-xs text-muted-foreground">
          {canInstall ? (
            <>Add Ronin to this device to open it full screen, like an app.</>
          ) : (
            <>Open the Share menu, then choose &ldquo;Add to Home Screen&rdquo;.</>
          )}
        </span>
      </div>
      {canInstall ? (
        <Button onClick={handleInstall} disabled={busy} className="shrink-0">
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Install
        </Button>
      ) : (
        <Share className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
