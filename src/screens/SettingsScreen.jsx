import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, HardDrive, Link2Off, Loader2, LogOut, RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NavPositionSetting } from "@/components/NavPosition";
import InboxDefaultTabSetting from "@/components/InboxDefaultTabSetting";
import CountryCodeSetting from "@/components/CountryCodeSetting";
import InstallAppSetting from "@/components/InstallAppSetting";
import ScreenHeader from "@/components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useInboxData } from "@/context/InboxDataContext";
import { useContactsData } from "@/context/ContactsDataContext";
import { useAccount } from "@/hooks/useAccount";
import { clearBackendData, disconnectAccount, requestPairingCode } from "@/lib/api";
import { clearLocalData } from "@/lib/localData";
import { formatPhone } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Digits only, from a WhatsApp jid (drops the domain + device suffix). */
function jidToDigits(jid) {
  if (!jid) return "";
  return jid
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
}

/** "m:ss" for a pairing-code countdown. */
function formatCountdown(seconds) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The word the user must type to arm a destructive clear. */
const CLEAR_PHRASE = "CLEAR";

/**
 * Password-gated, type-to-confirm dialog shared by the two "clear data"
 * actions. The caller performs the actual work in `onConfirm(password)` and
 * signals failure by throwing (the message is shown inline). On success the
 * dialog closes itself and resets.
 */
function PasswordConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
}) {
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();

  const phraseOk = phrase.trim().toUpperCase() === CLEAR_PHRASE;

  function reset() {
    setPassword("");
    setPhrase("");
    setError("");
    setBusy(false);
  }

  async function submit() {
    if (!password || !phraseOk || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(password);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-password`}>Password</Label>
            <Input
              id={`${fieldId}-password`}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-confirm`}>
              Type <span className="font-mono font-semibold">{CLEAR_PHRASE}</span> to confirm
            </Label>
            <Input
              id={`${fieldId}-confirm`}
              autoComplete="off"
              spellCheck={false}
              placeholder={CLEAR_PHRASE}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={busy}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              submit();
            }}
            disabled={!password || !phraseOk || busy}
          >
            {busy ? busyLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const { account, connected, state, refresh } = useAccount();
  const { user, signOut, verifyPassword } = useAuth();
  const { refresh: refreshInbox } = useInboxData();
  const { refresh: refreshContacts } = useContactsData();

  const [busy, setBusy] = useState(false);

  // Disconnect confirmation (password-gated).
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [password, setPassword] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");

  // "Clear data" confirmations (password + type-to-confirm) and inline result.
  const [confirmingClearBackend, setConfirmingClearBackend] = useState(false);
  const [confirmingClearLocal, setConfirmingClearLocal] = useState(false);
  const [clearNotice, setClearNotice] = useState("");

  // Pairing-code state (shown while the session isn't linked).
  const [pairNumber, setPairNumber] = useState(null);
  const [pairCode, setPairCode] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState("");
  const [pairExpiresAt, setPairExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const accountId = account?.id;
  const linked = connected;
  const canPair = state === "qr";
  // The number field mirrors the linked account until the user edits it, so
  // there's no state-sync effect (see handleDisconnect, which remembers it).
  const pairNumberValue = pairNumber ?? jidToDigits(accountId);
  const pairSecondsLeft = pairExpiresAt
    ? Math.max(0, Math.ceil((pairExpiresAt - now) / 1000))
    : 0;
  const pairExpired = pairCode !== "" && pairSecondsLeft <= 0;

  // Tick the countdown while a code is on screen.
  useEffect(() => {
    if (!pairCode) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairCode]);

  // Poll while unlinked so a successful link shows up without a reload.
  useEffect(() => {
    if (linked) return;
    const id = setInterval(() => refresh(), 4000);
    return () => clearInterval(id);
  }, [linked, refresh]);

  /** Re-verify the password, throwing a readable error when it's wrong. */
  async function verifyOrThrow(password) {
    const { error } = await verifyPassword(password);
    if (error) throw new Error(error.message || "Incorrect password.");
  }

  /** Wipe the server database + media, then refresh the in-memory caches. */
  async function handleClearBackend(password) {
    setClearNotice("");
    await verifyOrThrow(password);
    const result = await clearBackendData();
    await Promise.all([refreshInbox(), refreshContacts()]);
    const removed = result?.mediaRemoved ?? 0;
    setClearNotice(
      removed > 0
        ? `Server data cleared — ${removed} media file${removed === 1 ? "" : "s"} removed.`
        : "Server data cleared."
    );
  }

  /**
   * Wipe this device's cached data and preferences. The signed-in session is
   * kept, so a reload lands the user back in a freshly-empty app.
   */
  async function handleClearLocal(password) {
    await verifyOrThrow(password);
    await clearLocalData();
    window.location.reload();
  }

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
    if (!password || disconnecting) return;
    setDisconnecting(true);
    setDisconnectError("");
    const { error } = await verifyPassword(password);
    if (error) {
      setDisconnectError(error.message || "Incorrect password.");
      setDisconnecting(false);
      return;
    }
    try {
      await disconnectAccount();
      setPassword("");
      // Remember the number and drop any stale code for the re-link panel.
      setPairNumber(jidToDigits(accountId));
      setPairCode("");
      setPairError("");
      setConfirmingDisconnect(false);
      refresh();
    } catch (err) {
      setDisconnectError(err?.message || "Couldn't disconnect. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function getPairingCode() {
    if (pairBusy || !pairNumberValue.trim()) return;
    setPairBusy(true);
    setPairError("");
    try {
      const data = await requestPairingCode(pairNumberValue.trim());
      setPairCode(data?.code ?? "");
      setPairExpiresAt(Date.now() + (data?.expiresInMs ?? 180000));
      setNow(Date.now());
    } catch (err) {
      if (err?.status === 409) {
        setPairError("Still reconnecting — try again in a moment.");
      } else {
        setPairError(err?.message || "Couldn't get a pairing code.");
      }
    } finally {
      setPairBusy(false);
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
          <InstallAppSetting />
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {linked
              ? "Manage your session and the account used to send messages."
              : "No account is connected. Link a device to send broadcasts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {linked ? (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {account ? account.name || formatPhone(account.id) : "…"}
              </p>
              <p className="text-xs text-muted-foreground">
                {account ? formatPhone(account.id) : "…"}
              </p>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-3">
              {canPair ? (
                <>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Link a device</p>
                    <p className="text-xs text-muted-foreground">
                      On your phone: WhatsApp {"\u2192"} Linked devices {"\u2192"} Link a
                      device {"\u2192"} &ldquo;Link with phone number instead&rdquo;.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="pair-number">WhatsApp number</Label>
                    <Input
                      id="pair-number"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="2348012345678"
                      value={pairNumberValue}
                      onChange={(e) => setPairNumber(e.target.value)}
                      disabled={pairBusy}
                    />
                    <p className="text-xs text-muted-foreground">
                      Include the country code.
                    </p>
                  </div>

                  {pairCode ? (
                    <div className="space-y-1">
                      <p className="text-2xl font-semibold tracking-[0.2em]">
                        {pairCode}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pairExpired
                          ? "That code expired — get a new one."
                          : `Expires in ${formatCountdown(pairSecondsLeft)}`}
                      </p>
                    </div>
                  ) : null}

                  <Button
                    onClick={getPairingCode}
                    disabled={pairBusy || !pairNumberValue.trim()}
                  >
                    {pairBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : pairCode ? (
                      <RefreshCw className="size-4" />
                    ) : null}
                    {pairCode ? "Get a new code" : "Get pairing code"}
                  </Button>

                  {pairError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {pairError}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {state === "logged_out"
                    ? "Session unlinked — preparing to link…"
                    : "Connecting…"}
                </div>
              )}
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
                  Unlink the device. Scheduled broadcasts won't be sent.
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={!linked || busy || disconnecting}
              >
                <Link2Off className="size-4" />
                Disconnect
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>
            Permanently delete stored messages and media. These actions can't be
            undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y rounded-lg border border-destructive/30">
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Clear server data</span>
                <span className="text-xs text-muted-foreground">
                  Delete every message, chat, contact and media file on the
                  server. Your WhatsApp account stays linked.
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={() => setConfirmingClearBackend(true)}
                className="shrink-0"
              >
                <Database className="size-4" />
                Clear
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Clear local data</span>
                <span className="text-xs text-muted-foreground">
                  Delete the messages cached on this device and reset your
                  preferences. You stay signed in.
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={() => setConfirmingClearLocal(true)}
                className="shrink-0"
              >
                <HardDrive className="size-4" />
                Clear
              </Button>
            </div>
          </div>

          {clearNotice ? (
            <p role="status" className="text-xs text-muted-foreground">
              {clearNotice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Clear server data (password + type-to-confirm) */}
      <PasswordConfirmDialog
        open={confirmingClearBackend}
        onOpenChange={setConfirmingClearBackend}
        title="Clear all server data?"
        description="Every message, chat, contact, list, template, broadcast, guard setting and automation will be permanently deleted from the server, along with all stored media. Your WhatsApp account stays linked. This can't be undone."
        confirmLabel="Clear server data"
        busyLabel="Clearing…"
        onConfirm={handleClearBackend}
      />

      {/* Clear local data (password + type-to-confirm) */}
      <PasswordConfirmDialog
        open={confirmingClearLocal}
        onOpenChange={setConfirmingClearLocal}
        title="Clear all local data?"
        description="The messages cached on this device and your app preferences will be deleted, and the app will reload. You stay signed in. This can't be undone."
        confirmLabel="Clear local data"
        busyLabel="Clearing…"
        onConfirm={handleClearLocal}
      />

      {/* Disconnect confirmation (password re-entry) */}
      <AlertDialog
        open={confirmingDisconnect}
        onOpenChange={(open) => {
          if (disconnecting) return;
          setConfirmingDisconnect(open);
          if (!open) {
            setPassword("");
            setDisconnectError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks the device from your phone. Broadcasts in the schedule
              queue won't be sent until you link an account again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disconnect-password">Password</Label>
            <Input
              id="disconnect-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleDisconnect();
                }
              }}
              disabled={disconnecting}
              autoFocus
            />
            {user?.email ? (
              <p className="text-xs text-muted-foreground">
                Signed in as {user.email}
              </p>
            ) : null}
            {disconnectError ? (
              <p role="alert" className="text-sm text-destructive">
                {disconnectError}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDisconnect();
              }}
              disabled={!password || disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
