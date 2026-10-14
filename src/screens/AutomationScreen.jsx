import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    createAutoReply,
    deleteAutoReply,
    getAwaySettings,
    listAutoReplies,
    listAutomationGroups,
    listTemplates,
    saveAwaySettings,
    updateAutoReply,
} from "@/lib/api";
import ScreenHeader from "@/components/ScreenHeader";

/* -------------------------------------------------------------------------- */
/*  Mock data: the Connection tab is still a placeholder                      */
/* -------------------------------------------------------------------------- */

const WEBHOOK_URL = "https://api.example.com/webhooks/incoming";

const MOCK_CONNECTION = {
    connected: true,
    lastChecked: "2 min ago",
};

const MOCK_WEBHOOK_LOGS = [
    { id: 1, time: "2 min ago", event: "message.received", status: 200, ms: 112 },
    { id: 2, time: "9 min ago", event: "message.received", status: 200, ms: 98 },
    { id: 3, time: "31 min ago", event: "message.status", status: 500, ms: 2040 },
    { id: 4, time: "1 hr ago", event: "message.received", status: 200, ms: 134 },
    { id: 5, time: "2 hr ago", event: "group.update", status: 200, ms: 87 },
];

const MATCH_TYPES = [
    { value: "contains", label: "Message contains keyword" },
    { value: "exact", label: "Message is exactly the keyword" },
];

/** Friendly labels for a template attachment type. */
const MEDIA_LABELS = {
    image: "Image",
    video: "Video",
    audio: "Audio",
    document: "Document",
};

/** A short single-line preview of a template body. */
function bodyPreview(text, max = 200) {
    const clean = String(text ?? "").trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/* -------------------------------------------------------------------------- */
/*  Shared bits                                                               */
/* -------------------------------------------------------------------------- */

/** Centered spinner used while a section's data loads. */
function Loading({ label }) {
    return (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {label}
        </div>
    );
}

/** Inline error with an optional retry action. */
function ErrorNotice({ message, onRetry }) {
    if (!message) return null;
    return (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-5 text-center">
            <p className="text-sm text-destructive">{message}</p>
            {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCw className="size-4" />
                    Retry
                </Button>
            )}
        </div>
    );
}

/**
 * Template picker shared by the auto-reply form and away mode. Replies are
 * always broadcast templates, so this only ever offers saved templates.
 */
function TemplatePicker({ id, templates, loading, error, value, onChange }) {
    const items = templates.map((t) => ({ value: String(t.id), label: t.title }));
    return (
        <>
            <Select
                value={value || null}
                onValueChange={onChange}
                items={items}
                disabled={loading || Boolean(error)}
            >
                <SelectTrigger id={id} className="w-full">
                    <SelectValue
                        placeholder={loading ? "Loading templates…" : "Select a template"}
                    />
                </SelectTrigger>
                <SelectContent>
                    {templates.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                            {t.title}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {error ? (
                <p className="text-xs text-destructive">{error}</p>
            ) : !loading && templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    No templates yet — create one on the Broadcasts screen first.
                </p>
            ) : null}
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function AutomationScreen() {
    // Templates back both tabs, so they're fetched once here.
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [templatesError, setTemplatesError] = useState("");

    // Fetch without setting state synchronously, so the mount effect below
    // stays a pure subscription (react-hooks/set-state-in-effect).
    function fetchTemplates() {
        return listTemplates()
            .then((list) => {
                setTemplates(list);
                setTemplatesError("");
            })
            .catch((err) => setTemplatesError(err?.message || "Couldn't load templates."))
            .finally(() => setTemplatesLoading(false));
    }

    function retryTemplates() {
        setTemplatesLoading(true);
        fetchTemplates();
    }

    useEffect(() => {
        fetchTemplates();
    }, []);

    return (
        <div className="mx-auto w-full max-w-2xl py-4">
            <Tabs defaultValue="replies">
                <ScreenHeader title="Automation" className="mb-4">
                    <TabsList className="w-full mb-3">
                        <TabsTrigger value="replies">Auto-replies</TabsTrigger>
                        <TabsTrigger value="away">Away mode</TabsTrigger>
                    </TabsList>
                </ScreenHeader>

                <TabsContent value="replies" className="mt-4 space-y-4">
                    <AutoReplies
                        templates={templates}
                        templatesLoading={templatesLoading}
                        templatesError={templatesError}
                        onRetryTemplates={retryTemplates}
                    />
                </TabsContent>
                <TabsContent value="away" className="mt-4 space-y-4">
                    <AwayMode
                        templates={templates}
                        templatesLoading={templatesLoading}
                        templatesError={templatesError}
                        onRetryTemplates={retryTemplates}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Auto-replies                                                              */
/* -------------------------------------------------------------------------- */

function AutoReplies({ templates, templatesLoading, templatesError, onRetryTemplates }) {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    // Which rows have their details open; multiple can stay expanded.
    const [expanded, setExpanded] = useState({});
    // The rule awaiting delete confirmation (null when the dialog is closed).
    const [pendingDelete, setPendingDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    // Groups available as a reply scope.
    const [groups, setGroups] = useState([]);
    const [groupsLoading, setGroupsLoading] = useState(true);
    const [groupsError, setGroupsError] = useState("");

    // New-rule form.
    const [keyword, setKeyword] = useState("");
    const [match, setMatch] = useState("contains");
    const [templateId, setTemplateId] = useState("");
    const [dm, setDm] = useState(true);
    const [quote, setQuote] = useState(true);
    const [groupSelection, setGroupSelection] = useState({}); // { [jid]: true }
    const [adding, setAdding] = useState(false);
    const [formError, setFormError] = useState("");

    const templatesById = useMemo(
        () => new Map(templates.map((t) => [String(t.id), t])),
        [templates]
    );

    const groupsById = useMemo(
        () => new Map(groups.map((g) => [g.jid, g])),
        [groups]
    );

    function fetchRules() {
        return listAutoReplies()
            .then((list) => {
                setRules(list);
                setError("");
            })
            .catch((err) => setError(err?.message || "Couldn't load auto-replies."))
            .finally(() => setLoading(false));
    }

    function fetchGroups() {
        return listAutomationGroups()
            .then((list) => {
                setGroups(list);
                setGroupsError("");
            })
            .catch((err) => setGroupsError(err?.message || "Couldn't load groups."))
            .finally(() => setGroupsLoading(false));
    }

    function retryRules() {
        setLoading(true);
        fetchRules();
    }

    function retryGroups() {
        setGroupsLoading(true);
        fetchGroups();
    }

    useEffect(() => {
        fetchRules();
        fetchGroups();
    }, []);

    const selectedGroups = Object.keys(groupSelection).filter((jid) => groupSelection[jid]);
    const trimmedKeyword = keyword.trim();
    const duplicate = rules.some(
        (r) => r.keyword.toLowerCase() === trimmedKeyword.toLowerCase()
    );
    const hasScope = dm || selectedGroups.length > 0;
    const canAdd =
        trimmedKeyword !== "" &&
        templateId !== "" &&
        !duplicate &&
        hasScope &&
        !adding &&
        !templatesError;

    async function addRule() {
        if (!canAdd) return;
        setAdding(true);
        setFormError("");
        try {
            const rule = await createAutoReply({
                keyword: trimmedKeyword,
                match,
                templateId,
                dm,
                quote,
                groups: selectedGroups,
            });
            setRules((prev) => [...prev, rule]);
            setKeyword("");
            setMatch("contains");
            setTemplateId("");
            setDm(true);
            setQuote(true);
            setGroupSelection({});
        } catch (err) {
            setFormError(err?.message || "Couldn't save the auto-reply.");
        } finally {
            setAdding(false);
        }
    }

    async function toggleRule(rule, enabled) {
        // Optimistic: flip immediately, revert if the write fails.
        setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
        try {
            const updated = await updateAutoReply(rule.id, { enabled });
            if (updated) setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
        } catch (err) {
            setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
            setError(err?.message || "Couldn't update the auto-reply.");
        }
    }

    async function confirmDelete() {
        if (!pendingDelete || deleting) return;
        setDeleting(true);
        setDeleteError("");
        try {
            await deleteAutoReply(pendingDelete.id);
            setRules((prev) => prev.filter((r) => r.id !== pendingDelete.id));
            setPendingDelete(null);
        } catch (err) {
            setDeleteError(err?.message || "Couldn't delete the auto-reply.");
        } finally {
            setDeleting(false);
        }
    }

    function closeDelete() {
        if (deleting) return;
        setPendingDelete(null);
        setDeleteError("");
    }

    function scopeLabel(rule) {
        const parts = [];
        if (rule.dm) parts.push("Direct messages");
        if (rule.groups?.length) {
            parts.push(`${rule.groups.length} group${rule.groups.length === 1 ? "" : "s"}`);
        }
        return parts.length ? parts.join(" · ") : "No audience";
    }

    /** Expands/collapses a rule's details (multiple rows may stay open). */
    function toggleExpanded(id) {
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    }

    /** Full audience description with group names resolved. */
    function audienceText(rule) {
        const parts = [];
        if (rule.dm) parts.push("Direct messages");
        const names = (rule.groups ?? []).map(
            (jid) => groupsById.get(jid)?.name?.trim() || jid
        );
        if (names.length) {
            parts.push(`${names.length === 1 ? "Group" : "Groups"}: ${names.join(", ")}`);
        }
        return parts.length ? parts.join(" · ") : "No audience";
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>New auto-reply</CardTitle>
                    <CardDescription>
                        Reply with a template when a message matches a keyword. Matching
                        ignores upper and lower case; only the first match replies.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="rule-keyword">Keyword</Label>
                            <Input
                                id="rule-keyword"
                                placeholder="PRICE"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rule-match">Match</Label>
                            <Select value={match} onValueChange={setMatch}>
                                <SelectTrigger id="rule-match" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MATCH_TYPES.map((m) => (
                                        <SelectItem key={m.value} value={m.value}>
                                            {m.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="rule-template">Reply template</Label>
                        <TemplatePicker
                            id="rule-template"
                            templates={templates}
                            loading={templatesLoading}
                            error={templatesError}
                            value={templateId}
                            onChange={setTemplateId}
                        />
                        {templatesError && onRetryTemplates && (
                            <Button variant="outline" size="sm" onClick={onRetryTemplates}>
                                <RefreshCw className="size-4" />
                                Retry
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <Label htmlFor="rule-dm" className="flex-1 cursor-pointer">
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Direct messages</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    Reply when someone messages you one-on-one.
                                </span>
                            </span>
                        </Label>
                        <Switch id="rule-dm" checked={dm} onCheckedChange={setDm} />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <Label htmlFor="rule-quote" className="flex-1 cursor-pointer">
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Reply to the message</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    Quote the message that triggered the reply. Turn off to
                                    send it as a standalone message.
                                </span>
                            </span>
                        </Label>
                        <Switch id="rule-quote" checked={quote} onCheckedChange={setQuote} />
                    </div>

                    <div className="space-y-2">
                        <Label>Groups</Label>
                        {groupsLoading ? (
                            <Loading label="Loading groups…" />
                        ) : groupsError ? (
                            <ErrorNotice message={groupsError} onRetry={retryGroups} />
                        ) : groups.length === 0 ? (
                            <p className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                                Join a group to reply in it. Direct messages still work.
                            </p>
                        ) : (
                            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                                {groups.map((g) => {
                                    const label = g.name?.trim() || g.jid;
                                    return (
                                        <li
                                            key={g.jid}
                                            className="flex items-center justify-between gap-3 p-3"
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="truncate text-sm">{label}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <Switch
                                                aria-label={`Reply in ${label}`}
                                                checked={Boolean(groupSelection[g.jid])}
                                                onCheckedChange={(checked) =>
                                                    setGroupSelection((prev) => ({
                                                        ...prev,
                                                        [g.jid]: checked,
                                                    }))
                                                }
                                            />
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {duplicate && (
                        <p className="text-sm text-destructive">
                            A rule for "{trimmedKeyword}" already exists.
                        </p>
                    )}
                    {!hasScope && (
                        <p className="text-sm text-muted-foreground">
                            Pick at least one audience: direct messages or a group.
                        </p>
                    )}
                    {formError && <p className="text-sm text-destructive">{formError}</p>}
                </CardContent>
                <CardFooter>
                    <Button onClick={addRule} disabled={!canAdd} className="w-full">
                        {adding && <Loader2 className="size-4 animate-spin" />}
                        Add auto-reply
                    </Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1.5">
                            <CardTitle>Your auto-replies</CardTitle>
                            <CardDescription>
                                {loading || error
                                    ? "Replies run in the order shown."
                                    : rules.length === 0
                                        ? "No auto-replies yet. Add your first one above."
                                        : `${rules.filter((r) => r.enabled).length} of ${rules.length} turned on.`}
                            </CardDescription>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Refresh auto-replies"
                            onClick={retryRules}
                            disabled={loading}
                        >
                            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                        </Button>
                    </div>
                </CardHeader>
                {loading ? (
                    <CardContent>
                        <Loading label="Loading auto-replies…" />
                    </CardContent>
                ) : error ? (
                    <CardContent>
                        <ErrorNotice message={error} onRetry={retryRules} />
                    </CardContent>
                ) : rules.length > 0 ? (
                    <CardContent>
                        <ul className="divide-y rounded-lg border">
                            {rules.map((r) => {
                                const template = r.templateId
                                    ? templatesById.get(String(r.templateId))
                                    : null;
                                const open = Boolean(expanded[r.id]);
                                const panelId = `reply-details-${r.id}`;
                                const preview = template ? bodyPreview(template.body) : "";
                                return (
                                    <li key={r.id} className="space-y-2 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <button
                                                type="button"
                                                onClick={() => toggleExpanded(r.id)}
                                                aria-expanded={open}
                                                aria-controls={panelId}
                                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                            >
                                                <ChevronRight
                                                    className={cn(
                                                        "size-4 shrink-0 text-muted-foreground transition-transform",
                                                        open && "rotate-90"
                                                    )}
                                                />
                                                <span className="flex min-w-0 flex-col gap-0.5">
                                                    <span className="truncate text-sm font-medium">
                                                        {r.keyword}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {r.match === "exact"
                                                            ? "Exact match"
                                                            : "Contains keyword"}
                                                        {" · "}
                                                        {r.quote
                                                            ? "Quoted reply"
                                                            : "New message"}
                                                        {" · "}
                                                        {scopeLabel(r)}
                                                    </span>
                                                </span>
                                            </button>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    aria-label={`Turn ${r.enabled ? "off" : "on"} reply for ${r.keyword}`}
                                                    checked={r.enabled}
                                                    onCheckedChange={(checked) =>
                                                        toggleRule(r, checked)
                                                    }
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`Delete reply for ${r.keyword}`}
                                                    onClick={() => setPendingDelete(r)}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        <p
                                            className={cn(
                                                "truncate rounded-lg bg-muted p-3 text-sm text-muted-foreground",
                                                !r.enabled && "opacity-60"
                                            )}
                                        >
                                            {template ? (
                                                `Template: ${template.title}`
                                            ) : (
                                                <span className="text-destructive">
                                                    {r.templateId
                                                        ? "Template missing"
                                                        : "No template"}
                                                </span>
                                            )}
                                        </p>
                                        {open && (
                                            <div
                                                id={panelId}
                                                className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm"
                                            >
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        Reply template
                                                    </span>
                                                    {template ? (
                                                        <>
                                                            <span className="font-medium">
                                                                {template.title}
                                                            </span>
                                                            {template.media?.type && (
                                                                <span className="text-xs text-muted-foreground">
                                                                    Media:{" "}
                                                                    {MEDIA_LABELS[
                                                                        template.media.type
                                                                    ] ?? template.media.type}
                                                                </span>
                                                            )}
                                                            {preview ? (
                                                                <span className="whitespace-pre-wrap break-words text-muted-foreground">
                                                                    {preview}
                                                                </span>
                                                            ) : template.media?.type ? (
                                                                <span className="text-muted-foreground">
                                                                    (media-only template)
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground">
                                                                    (empty body)
                                                                </span>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-destructive">
                                                            {r.templateId
                                                                ? "Template missing"
                                                                : "No template"}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-muted-foreground">
                                                            Match
                                                        </span>
                                                        <span>
                                                            {r.match === "exact"
                                                                ? "Message is exactly the keyword"
                                                                : "Message contains the keyword"}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-muted-foreground">
                                                            Reply style
                                                        </span>
                                                        <span>
                                                            {r.quote
                                                                ? "Quoted reply to the message"
                                                                : "Standalone message"}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-muted-foreground">
                                                            Audience
                                                        </span>
                                                        <span className="break-words">
                                                            {audienceText(r)}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-muted-foreground">
                                                            Created
                                                        </span>
                                                        <span>
                                                            {r.createdAt
                                                                ? new Date(
                                                                      r.createdAt
                                                                  ).toLocaleString()
                                                                : "—"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </CardContent>
                ) : null}
            </Card>

            <AlertDialog
                open={Boolean(pendingDelete)}
                onOpenChange={(open) => {
                    if (!open) closeDelete();
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this auto-reply?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete
                                ? `Messages matching "${pendingDelete.keyword}" will no longer get an automatic reply. This can't be undone.`
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deleteError ? (
                        <p role="alert" className="text-sm text-destructive">
                            {deleteError}
                        </p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                confirmDelete();
                            }}
                            disabled={deleting}
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Away mode                                                                 */
/* -------------------------------------------------------------------------- */

const EMPTY_AWAY = {
    enabled: false,
    start: "22:00",
    end: "07:00",
    templateId: "",
    oncePerContact: true,
    quote: true,
    timeZone: "",
};

function AwayMode({ templates, templatesLoading, templatesError, onRetryTemplates }) {
    const [savedAway, setSavedAway] = useState(EMPTY_AWAY);
    const [away, setAway] = useState(EMPTY_AWAY);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [saving, setSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    function fetchAway() {
        return getAwaySettings()
            .then((data) => {
                const next = { ...EMPTY_AWAY, ...(data ?? {}), templateId: data?.templateId ?? "" };
                setSavedAway(next);
                setAway(next);
                setLoadError("");
            })
            .catch((err) => setLoadError(err?.message || "Couldn't load away mode."))
            .finally(() => setLoading(false));
    }

    function retryAway() {
        setLoading(true);
        fetchAway();
    }

    useEffect(() => {
        fetchAway();
    }, []);

    const dirty = JSON.stringify(away) !== JSON.stringify(savedAway);
    const overnight = away.start > away.end;
    const error =
        away.start === "" || away.end === ""
            ? "Choose a start and end time."
            : away.start === away.end
                ? "Start and end time can't be the same."
                : away.enabled && !away.templateId
                    ? "Choose a template before turning on away mode."
                    : null;

    function update(patch) {
        setAway((prev) => ({ ...prev, ...patch }));
        setJustSaved(false);
        setSaveError("");
    }

    async function save() {
        if (error || !dirty) return;
        setSaving(true);
        setSaveError("");
        try {
            const data = await saveAwaySettings({ ...away, templateId: away.templateId || null });
            const next = { ...EMPTY_AWAY, ...(data ?? away), templateId: data?.templateId ?? "" };
            setSavedAway(next);
            setAway(next);
            setJustSaved(true);
        } catch (err) {
            setSaveError(err?.message || "Couldn't save away mode.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <Loading label="Loading away mode…" />
                </CardContent>
            </Card>
        );
    }

    if (loadError) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <ErrorNotice message={loadError} onRetry={retryAway} />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Away mode</CardTitle>
                <CardDescription>
                    Reply to direct messages that arrive outside your working hours.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <Label htmlFor="away-enabled" className="flex-1 cursor-pointer">
                        <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">Turn on away mode</span>
                            <span className="text-xs font-normal text-muted-foreground">
                                Applies to direct messages only, not groups.
                            </span>
                        </span>
                    </Label>
                    <Switch
                        id="away-enabled"
                        checked={away.enabled}
                        onCheckedChange={(checked) => update({ enabled: checked })}
                    />
                </div>

                <div className={cn("space-y-3", !away.enabled && "opacity-50")}>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="away-start">Away from</Label>
                            <Input
                                id="away-start"
                                type="time"
                                disabled={!away.enabled}
                                value={away.start}
                                onChange={(e) => update({ start: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="away-end">Back at</Label>
                            <Input
                                id="away-end"
                                type="time"
                                disabled={!away.enabled}
                                value={away.end}
                                onChange={(e) => update({ end: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="away-template">Away template</Label>
                        <TemplatePicker
                            id="away-template"
                            templates={templates}
                            loading={templatesLoading}
                            error={templatesError}
                            value={away.templateId}
                            onChange={(value) => update({ templateId: value })}
                        />
                        {templatesError && onRetryTemplates && (
                            <Button variant="outline" size="sm" onClick={onRetryTemplates}>
                                <RefreshCw className="size-4" />
                                Retry
                            </Button>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="away-timezone">Time zone</Label>
                        <Input
                            id="away-timezone"
                            placeholder="Defaults to the server's time zone"
                            disabled={!away.enabled}
                            value={away.timeZone}
                            onChange={(e) => update({ timeZone: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                            An IANA zone such as Africa/Lagos. Leave blank to use the
                            server's zone.
                        </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <Label htmlFor="away-once" className="flex-1 cursor-pointer">
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Reply once per person</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    Send the message only once during each away period.
                                </span>
                            </span>
                        </Label>
                        <Switch
                            id="away-once"
                            disabled={!away.enabled}
                            checked={away.oncePerContact}
                            onCheckedChange={(checked) => update({ oncePerContact: checked })}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <Label htmlFor="away-quote" className="flex-1 cursor-pointer">
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Reply to the message</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    Quote the message that triggered the reply. Turn off to
                                    send it as a standalone message.
                                </span>
                            </span>
                        </Label>
                        <Switch
                            id="away-quote"
                            disabled={!away.enabled}
                            checked={away.quote}
                            onCheckedChange={(checked) => update({ quote: checked })}
                        />
                    </div>
                </div>

                {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                ) : (
                    away.enabled && (
                        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                            Replies are sent from {away.start} to {away.end}
                            {overnight ? " (overnight, ending the next day)" : ""}, in{" "}
                            {away.timeZone ? away.timeZone : "the server's time zone"}.
                            {away.quote
                                ? " Replies quote the triggering message."
                                : " Replies are sent as standalone messages."}
                        </p>
                    )
                )}
                {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
                <Button onClick={save} disabled={!dirty || Boolean(error) || saving}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    Save changes
                </Button>
                {justSaved && (
                    <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                        <Check className="size-4" />
                        Away mode saved.
                    </p>
                )}
            </CardFooter>
        </Card>
    );
}

/* -------------------------------------------------------------------------- */
/*  Connection and webhook health (placeholder)                               */
/* -------------------------------------------------------------------------- */

function Connection() {
    const [connection, setConnection] = useState(MOCK_CONNECTION);
    const [testing, setTesting] = useState(false);
    const [copied, setCopied] = useState(false);

    const logs = MOCK_WEBHOOK_LOGS;
    const failed = logs.filter((l) => l.status >= 400).length;

    async function testConnection() {
        setTesting(true);
        try {
            // TODO: call your backend to check the API connection
            await new Promise((resolve) => setTimeout(resolve, 800));
            setConnection({ connected: true, lastChecked: "Just now" });
        } finally {
            setTesting(false);
        }
    }

    async function copyUrl() {
        try {
            await navigator.clipboard.writeText(WEBHOOK_URL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard unavailable: the URL is still selectable in the field
        }
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>API connection</CardTitle>
                    <CardDescription>
                        Automations only run while the connection is healthy.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    "size-2.5 rounded-full",
                                    connection.connected ? "bg-emerald-500" : "bg-destructive"
                                )}
                            />
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">
                                    {connection.connected ? "Connected" : "Disconnected"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    Last checked {connection.lastChecked}
                                </span>
                            </div>
                        </div>
                        <Button variant="outline" onClick={testConnection} disabled={testing}>
                            <Plug className="size-4" />
                            {testing ? "Testing..." : "Test connection"}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="webhook-url">Webhook URL</Label>
                        <div className="flex gap-2">
                            <Input id="webhook-url" readOnly value={WEBHOOK_URL} />
                            <Button
                                variant="outline"
                                size="icon"
                                aria-label="Copy webhook URL"
                                onClick={copyUrl}
                            >
                                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Webhook health</CardTitle>
                    <CardDescription>
                        {failed === 0
                            ? "All recent deliveries succeeded."
                            : `${failed} of ${logs.length} recent deliveries failed.`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {/* TODO: subscribe to your backend (websocket, SSE or polling) and prepend new deliveries */}
                    {logs.length === 0 ? (
                        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                            No deliveries yet. Events will appear here once your webhook receives them.
                        </p>
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {logs.map((log) => {
                                const ok = log.status < 400;
                                return (
                                    <li
                                        key={log.id}
                                        className="flex items-start justify-between gap-3 p-3"
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm font-medium">{log.event}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {ok ? "Delivered" : "Failed"} with status {log.status} in {log.ms} ms
                                            </span>
                                        </div>
                                        <span
                                            className={cn(
                                                "shrink-0 text-xs",
                                                ok ? "text-muted-foreground" : "text-destructive"
                                            )}
                                        >
                                            {log.time}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
