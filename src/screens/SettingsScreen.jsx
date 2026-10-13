import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2Off, LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NavPositionSetting } from "@/components/NavPosition";
import InboxDefaultTabSetting from "@/components/InboxDefaultTabSetting";
import CountryCodeSetting from "@/components/CountryCodeSetting";
import ScreenHeader from "@/components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useAccount } from "@/hooks/useAccount";
import { formatPhone } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const { account, connected } = useAccount();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Local-only acknowledgement of the (not-yet-existing) revoke action.
  const [disconnectRequested, setDisconnectRequested] = useState(false);
  const [busy, setBusy] = useState(false);

  const showConnected = connected && !disconnectRequested;

  const { signOut } = useAuth();

  async function handleSignOut() {
    setBusy(true);
    try {
      const { error } = await signOut();
      if (error) {
        console.error("Sign out error:", error);
      }
      navigate("/login");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      // TODO: backend revoke endpoint (not shipped); this is a local-only
      // placeholder — no network call is made.
      setDisconnectRequested(true);
    } finally {
      setBusy(false);
      setConfirmingDisconnect(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader title="Settings" />

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how the app looks and opens on this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="dark-mode" className="flex-1 cursor-pointer">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Dark mode</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Use a darker colour scheme.
                </span>
              </span>
            </Label>
            <Switch
              id="dark-mode"
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            />
          </div>
          <NavPositionSetting />
          <InboxDefaultTabSetting />
          <CountryCodeSetting />
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {showConnected
              ? "Manage your session and the account used to send messages."
              : "No account is connected. Reconnect to send broadcasts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {showConnected && (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {account ? account.name || formatPhone(account.id) : "…"}
              </p>
              <p className="text-xs text-muted-foreground">
                {account ? formatPhone(account.id) : "…"}
              </p>
            </div>
          )}

          <div className="divide-y rounded-lg border">
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Sign out</span>
                <span className="text-xs text-muted-foreground">
                  End your session on this device.
                </span>
              </div>
              <Button variant="outline" onClick={handleSignOut} disabled={busy}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Disconnect account</span>
                <span className="text-xs text-muted-foreground">
                  Stop sending from this account. Scheduled broadcasts won't be sent.
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={!showConnected || busy}
              >
                <Link2Off className="size-4" />
                Disconnect
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect confirmation */}
      <AlertDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
            <AlertDialogDescription>
              Broadcasts in the schedule queue won't be sent until you connect an
              account again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the request finishes
                handleDisconnect();
              }}
              disabled={busy}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}