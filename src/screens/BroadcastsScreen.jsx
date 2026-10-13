import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, History, Loader2, Plus, RefreshCw, Send } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getBroadcast,
  getBroadcasts,
  getList,
  listTemplates,
  sendBroadcast,
} from "@/lib/api";
import { useContactsData } from "@/context/ContactsDataContext";
import { useAuth } from "@/context/AuthContext";
import ScreenHeader from "@/components/ScreenHeader";

/* -------------------------------------------------------------------------- */
/*  Screen constants                                                          */
/* -------------------------------------------------------------------------- */

const DEFAULT_MIN_DELAY = 8;
const DEFAULT_MAX_DELAY = 25;

const STATUS_META = {
  sending: { label: "Sending", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "outline" },
  done: { label: "Done", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status || "Unknown", variant: "outline" };
}

/** A contact's display label, matching the rest of the app. */
function recipientLabel(recipient) {
  return recipient?.name?.trim() || recipient?.phone || "Unknown";
}

/** Short relative time for recent stamps, absolute for anything older/future. */
function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin >= 0) {
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
  }

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function BroadcastsScreen() {
  // The active tab lives in the URL so EditTemplate can link back to ?tab=templates
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = rawTab === "templates" || rawTab === "history" ? rawTab : "broadcast";

  const { user } = useAuth();

  // Broadcast lists (audiences) are shared with the Contacts screen.
  const {
    lists,
    loading: listsLoading,
    error: listsError,
  } = useContactsData();

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState("");

  const [templateId, setTemplateId] = useState(null);
  const [selected, setSelected] = useState({}); // { automotive: true, ... }
  // Cached membership per selected list: string[] of contact ids, or null when
  // the fetch failed (unknown). Used to dedupe the recipient estimate.
  const [listMembers, setListMembers] = useState({});
  const [minDelay, setMinDelay] = useState("");
  const [maxDelay, setMaxDelay] = useState("");

  // Send confirmation dialog.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mode, setMode] = useState("now"); // "now" | "schedule"
  const [sendAt, setSendAt] = useState(""); // datetime-local value
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [result, setResult] = useState(null); // { title, total, status, sendAt }

  // History tab.
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [refreshingBroadcasts, setRefreshingBroadcasts] = useState(false);
  const [broadcastsError, setBroadcastsError] = useState("");
  const [detail, setDetail] = useState(null); // { id, loading, error, broadcast, recipients }

  // Templates live on the backend now; fetched once when the tab mounts.
  useEffect(() => {
    let cancelled = false;

    listTemplates()
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        setTemplatesError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setTemplatesError(err?.message || "Couldn't load templates.");
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Recent broadcasts; loaded once, then refreshed on demand (no polling).
  useEffect(() => {
    let cancelled = false;

    getBroadcasts()
      .then((list) => {
        if (cancelled) return;
        setBroadcasts(list);
        setBroadcastsError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setBroadcastsError(err?.message || "Couldn't load broadcasts.");
      })
      .finally(() => {
        if (!cancelled) setLoadingBroadcasts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const template =
    templates.find((t) => String(t.id) === templateId) ?? null;
  const includedLists = lists.filter((l) => selected[l.id]);
  const eligibleRecipients = includedLists.reduce(
    (sum, l) => sum + (l.memberCount || 0),
    0
  );

  // Dedupe recipients: GET /api/lists only returns memberCount, so a contact in
  // two selected lists would be counted twice. Union the selected lists'
  // members (fetched + cached on selection) instead.
  const memberStates = includedLists.map((l) => listMembers[l.id]);
  const membersPending = memberStates.some((ids) => ids === undefined);
  const membersKnown = memberStates.every((ids) => Array.isArray(ids));
  const uniqueRecipients = membersKnown
    ? new Set(memberStates.flat()).size
    : eligibleRecipients;
  const recipientsExact = membersKnown;
  const recipientPhrase = membersPending
    ? "the selected contacts"
    : `${recipientsExact ? "" : "about "}${uniqueRecipients} ${
        uniqueRecipients === 1 ? "contact" : "contacts"
      }`;

  // Blank inputs fall back to the defaults shown as placeholders
  const min = minDelay === "" ? DEFAULT_MIN_DELAY : Number(minDelay);
  const max = maxDelay === "" ? DEFAULT_MAX_DELAY : Number(maxDelay);
  const delayError =
    min < 0 || max < 0
      ? "Delays can't be negative."
      : min > max
        ? "Min delay can't be greater than max delay."
        : null;

  const canSchedule = Boolean(template) && includedLists.length > 0 && !delayError;

  // Scheduling validation (mirrors the server's "strictly in the future" rule).
  const sendAtDate = mode === "schedule" && sendAt ? new Date(sendAt) : null;
  const sendAtMissing = mode === "schedule" && !sendAt;
  const sendAtInPast =
    mode === "schedule" &&
    sendAtDate &&
    (Number.isNaN(sendAtDate.getTime()) || sendAtDate.getTime() <= Date.now());
  const scheduleError = sendAtMissing
    ? null
    : sendAtInPast
      ? "Pick a time in the future."
      : null;
  const canConfirm =
    canSchedule && !sending && mode === "schedule"
      ? Boolean(sendAtDate) && !sendAtInPast
      : canSchedule && !sending;

  function chooseTemplate(value) {
    setTemplateId(value);
    setResult(null);
  }

  function toggleAudience(id, checked) {
    setSelected((prev) => ({ ...prev, [id]: checked }));
    setResult(null);

    // Fetch (once) and cache the list's members so the estimate can be deduped.
    if (!checked || listMembers[id] !== undefined) return;
    getList(id)
      .then((detail) => {
        setListMembers((prev) => ({ ...prev, [id]: detail?.contactIds ?? [] }));
      })
      .catch(() => {
        setListMembers((prev) => ({ ...prev, [id]: null }));
      });
  }

  function openConfirm() {
    if (!canSchedule) return;
    setMode("now");
    setSendAt("");
    setSendError("");
    setConfirmOpen(true);
  }

  async function confirmSend() {
    if (!canConfirm || !template) return;

    setSending(true);
    setSendError("");

    const res = await sendBroadcast({
      templateId: template.id,
      listIds: includedLists.map((l) => l.id),
      minDelay: min,
      maxDelay: max,
      sendAt: mode === "schedule" && sendAtDate ? sendAtDate.toISOString() : null,
      senderEmail: user?.email ?? null,
    });

    setSending(false);

    if (!res.ok) {
      setSendError(res.error || "Couldn't send the broadcast.");
      return;
    }

    const created = res.broadcast;
    if (created) setBroadcasts((prev) => [created, ...prev]);

    setResult({
      title: template.title,
      total: created?.total ?? uniqueRecipients,
      status: created?.status ?? (mode === "schedule" ? "scheduled" : "sending"),
      sendAt: created?.sendAt ?? null,
    });
    setConfirmOpen(false);

    // Reset the form now that the broadcast is queued.
    setTemplateId(null);
    setSelected({});
    setMinDelay("");
    setMaxDelay("");
  }

  async function refreshBroadcasts() {
    setRefreshingBroadcasts(true);
    try {
      setBroadcasts(await getBroadcasts());
      setBroadcastsError("");
    } catch (err) {
      setBroadcastsError(err?.message || "Couldn't load broadcasts.");
    } finally {
      setRefreshingBroadcasts(false);
      setLoadingBroadcasts(false);
    }
  }

  async function openDetail(broadcast) {
    setDetail({
      id: broadcast.id,
      loading: true,
      error: "",
      broadcast,
      recipients: [],
    });

    try {
      const { broadcast: full, recipients } = await getBroadcast(broadcast.id);
      setDetail((prev) =>
        prev && prev.id === broadcast.id
          ? { id: broadcast.id, loading: false, error: "", broadcast: full ?? broadcast, recipients }
          : prev
      );
    } catch (err) {
      setDetail((prev) =>
        prev && prev.id === broadcast.id
          ? { ...prev, loading: false, error: err?.message || "Couldn't load the recipients." }
          : prev
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setSearchParams(value === "broadcast" ? {} : { tab: value })
        }
      >
        <ScreenHeader
          title="Broadcasts"
          className="mb-4"
          action={
            tab !== "templates" ? null : (
              <Link
                to="/broadcasts/templates/new"
                aria-label="New template"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <Plus className="size-4" />
              </Link>
            )
          }
        >
          <TabsList className="w-full mb-3">
            <TabsTrigger value="broadcast">Broadcast</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </ScreenHeader>

        {/* ---------------------------- Broadcast tab ---------------------------- */}
        <TabsContent value="broadcast" className="mt-4 space-y-4">
          {/* Template */}
          <Card>
            <CardHeader>
              <CardTitle>Template</CardTitle>
              <CardDescription>Choose the message to send.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={templateId}
                onValueChange={chooseTemplate}
                items={templates.map((t) => ({
                  value: String(t.id),
                  label: t.title,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {template && (
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  {template.body || "(media-only template)"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Audiences */}
          <Card>
            <CardHeader>
              <CardTitle>Audiences</CardTitle>
              <CardDescription>Switch on the lists that should receive it.</CardDescription>
            </CardHeader>
            <CardContent>
              {listsLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading lists…
                </div>
              ) : listsError ? (
                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center">
                  <p role="alert" className="text-sm text-destructive">
                    {listsError.message || "Couldn't load your lists."}
                  </p>
                  <Link
                    to="/contacts?tab=lists"
                    className="text-sm underline underline-offset-4 hover:text-foreground"
                  >
                    Manage lists
                  </Link>
                </div>
              ) : lists.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No lists yet.</p>
                  <Link
                    to="/contacts/lists/new"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Plus className="size-4" />
                    Create a list
                  </Link>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {lists.map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <Label
                        htmlFor={`audience-${list.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{list.name}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {list.memberCount}{" "}
                            {list.memberCount === 1 ? "contact" : "contacts"}
                          </span>
                        </span>
                      </Label>
                      <Switch
                        id={`audience-${list.id}`}
                        checked={Boolean(selected[list.id])}
                        onCheckedChange={(checked) =>
                          toggleAudience(list.id, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Link
                to="/contacts?tab=lists"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Manage lists
              </Link>
            </CardFooter>
          </Card>

          {/* Delivery settings */}
          <Card>
            <CardHeader>
              <CardTitle>Delivery settings</CardTitle>
              <CardDescription>
                A random pause between each message. Leave blank to use{" "}
                {DEFAULT_MIN_DELAY} and {DEFAULT_MAX_DELAY} seconds.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="min-delay">Min delay (seconds)</Label>
                  <Input
                    id="min-delay"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder={String(DEFAULT_MIN_DELAY)}
                    value={minDelay}
                    onChange={(e) => setMinDelay(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-delay">Max delay (seconds)</Label>
                  <Input
                    id="max-delay"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder={String(DEFAULT_MAX_DELAY)}
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(e.target.value)}
                  />
                </div>
              </div>
              {delayError && (
                <p className="text-sm text-destructive">{delayError}</p>
              )}
            </CardContent>
          </Card>

          {/* Review */}
          <Card>
            <CardHeader>
              <CardTitle>Review broadcast</CardTitle>
              <CardDescription>
                {template
                  ? `Template: ${template.title}`
                  : "Select a template and at least one audience."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold">
                    {membersPending ? (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      uniqueRecipients
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {recipientsExact ? "Recipients" : "Estimated recipients"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold">{includedLists.length}</p>
                  <p className="text-sm text-muted-foreground">Audience lists included</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              <Button onClick={openConfirm} disabled={!canSchedule || sending}>
                <Send className="size-4" />
                Send broadcast
              </Button>
              {result && (
                <p className="flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
                  <Check className="size-4" />
                  {result.status === "scheduled"
                    ? `"${result.title}" scheduled${result.sendAt ? ` for ${formatWhen(result.sendAt)}` : ""} — ${result.total} ${result.total === 1 ? "contact" : "contacts"}.`
                    : `Broadcasting "${result.title}" to ${result.total} ${result.total === 1 ? "contact" : "contacts"}…`}
                </p>
              )}
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ---------------------------- Templates tab ---------------------------- */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          {loadingTemplates ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading templates…
            </div>
          ) : templatesError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <p role="alert" className="text-sm text-destructive">
                {templatesError}
              </p>
              <Link to="/broadcasts/templates/new" className={buttonVariants()}>
                <Plus className="size-4" />
                New template
              </Link>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <p className="text-sm font-medium">No templates yet — create one.</p>
              <Link to="/broadcasts/templates/new" className={buttonVariants()}>
                <Plus className="size-4" />
                New template
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {templates.map((t) => (
                <Link
                  key={t.id}
                  to={`/broadcasts/templates/${t.id}`}
                  className="group block"
                >
                  <Card className="h-full transition-colors group-hover:bg-muted/50">
                    <CardHeader>
                      <CardTitle className="truncate text-sm">{t.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="line-clamp-4 text-sm text-muted-foreground">
                        {t.body}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------------------------- History tab ---------------------------- */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Recent broadcasts, newest first.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshBroadcasts}
              disabled={loadingBroadcasts || refreshingBroadcasts}
            >
              {refreshingBroadcasts ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
          </div>

          {loadingBroadcasts ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading broadcasts…
            </div>
          ) : broadcastsError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <p role="alert" className="text-sm text-destructive">
                {broadcastsError}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshBroadcasts}
                disabled={refreshingBroadcasts}
              >
                Try again
              </Button>
            </div>
          ) : broadcasts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
              <History className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {broadcasts.map((b) => {
                const meta = statusMeta(b.status);
                const total = Number(b.total) || 0;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openDetail(b)}
                    className="w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {b.templateTitle || "Template"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {total} {total === 1 ? "recipient" : "recipients"}
                          {Number(b.failed) > 0 ? ` · ${b.failed} failed` : ""}
                        </span>
                      </span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {b.sendAt
                        ? `Scheduled ${formatWhen(b.sendAt)}`
                        : formatWhen(b.createdAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Send confirmation dialog. */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !sending) {
            setConfirmOpen(false);
            setSendError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "schedule"
                ? `This schedules "${template?.title ?? "this template"}" for the time you pick. It can't be undone.`
                : `This sends "${template?.title ?? "this template"}" to ${recipientPhrase}. It can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="broadcast-mode"
                value="now"
                checked={mode === "now"}
                onChange={() => setMode("now")}
                disabled={sending}
                className="size-4 accent-primary"
              />
              Send now
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="broadcast-mode"
                value="schedule"
                checked={mode === "schedule"}
                onChange={() => setMode("schedule")}
                disabled={sending}
                className="size-4 accent-primary"
              />
              Schedule for later
            </label>

            {mode === "schedule" && (
              <div className="space-y-2 pl-6">
                <Input
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                  disabled={sending}
                />
                {scheduleError && (
                  <p role="alert" className="text-sm text-destructive">
                    {scheduleError}
                  </p>
                )}
              </div>
            )}
          </div>

          {sendError ? (
            <p role="alert" className="text-sm text-destructive">
              {sendError}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmSend();
              }}
              disabled={!canConfirm}
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {mode === "schedule" ? "Scheduling…" : "Sending…"}
                </>
              ) : mode === "schedule" ? (
                "Confirm schedule"
              ) : (
                "Confirm and send"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Broadcast detail: recipients. */}
      <Sheet
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[85svh]">
          <SheetHeader>
            <SheetTitle>{detail?.broadcast?.templateTitle || "Broadcast"}</SheetTitle>
            <SheetDescription>
              {detail?.broadcast
                ? `${Number(detail.broadcast.total) || 0} recipients · ${
                    Number(detail.broadcast.sent) || 0
                  } sent · ${Number(detail.broadcast.failed) || 0} failed`
                : "Loading…"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            {detail?.broadcast && (
              <div className="flex items-center gap-2">
                <Badge variant={statusMeta(detail.broadcast.status).variant}>
                  {statusMeta(detail.broadcast.status).label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {detail.broadcast.sendAt
                    ? `Scheduled ${formatWhen(detail.broadcast.sendAt)}`
                    : formatWhen(detail.broadcast.createdAt)}
                </span>
              </div>
            )}

            {detail?.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading recipients…
              </div>
            ) : detail?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {detail.error}
              </p>
            ) : detail?.recipients?.length ? (
              <div className="rounded-lg border px-3">
                {detail.recipients.map((recipient, index) => (
                  <div
                    key={`${recipient.phone}-${index}`}
                    className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {recipientLabel(recipient)}
                      </span>
                      {recipient.error ? (
                        <span className="block truncate text-xs text-destructive">
                          {recipient.error}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`shrink-0 text-xs ${
                        recipient.status === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {recipient.status === "sent"
                        ? "Sent"
                        : recipient.status === "failed"
                          ? "Failed"
                          : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recipient details available.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
