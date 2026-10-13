import { useEffect, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import ScreenHeader from "@/components/ScreenHeader";
import {
  getGuardSettings,
  listGuardGroups,
  listModerationLog,
  saveGuardSettings,
} from "@/lib/api";
import {
  DEFAULT_WARN_TEMPLATE,
  SENSITIVITY_LEVELS,
  WARN_TEMPLATE_TOKENS,
  formToPayload,
  isValidHost,
  normalizeHost,
  renderWarnTemplate,
  settingsToForm,
  validateGuardForm,
} from "@/lib/guards";
import { useInboxEventsListener } from "@/context/InboxEventsContext";

const LOG_LIMIT = 50;

/** Action → Badge variant, so the log reads at a glance. */
const ACTION_VARIANT = {
  Deleted: "outline",
  Warned: "secondary",
  Kicked: "destructive",
};

/** Best display name for a group, falling back to its jid. */
function groupLabel(group) {
  return group.name?.trim() || group.jid;
}

/** Full picker label: name (member count) plus a guarded marker. */
function groupOptionLabel(group) {
  return `${groupLabel(group)} (${group.memberCount} members)${
    group.guarded ? " • guarded" : ""
  }`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Guards: per-group auto-moderation. Configure groups where the linked account
 * is an admin — link rules with a host whitelist, toxicity sensitivity and the
 * warn/kick strike thresholds, plus a live moderation log.
 *
 * All enforcement happens server-side; this screen reads and writes settings and
 * streams new log entries over the shared SSE connection.
 */
export default function GuardsScreen() {
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");

  const [jid, setJid] = useState("");
  const [settings, setSettings] = useState(null); // last saved form
  const [form, setForm] = useState(null); // current draft form
  const [logs, setLogs] = useState([]);

  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const [hostInput, setHostInput] = useState("");
  const [hostError, setHostError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const group = groups.find((g) => g.jid === jid) ?? null;

  const dirty =
    Boolean(form && settings) &&
    JSON.stringify(form) !== JSON.stringify(settings);
  const validationError = form ? validateGuardForm(form) : null;
  const canSave = Boolean(group) && dirty && !validationError && !saving;
  const sensitivityHint = SENSITIVITY_LEVELS.find(
    (s) => s.id === form?.sensitivity
  )?.hint;

  // Retry handler for a failed group load (event handlers may set state freely).
  function reloadGroups() {
    setGroupsLoading(true);
    setGroupsError("");
    listGuardGroups()
      .then((list) => {
        setGroups(list);
        setGroupsError("");
      })
      .catch((err) =>
        setGroupsError(err?.message || "Couldn't load your groups.")
      )
      .finally(() => setGroupsLoading(false));
  }

  // Mount: load the configurable groups. State is only touched inside the
  // promise callbacks, never synchronously in the effect body.
  useEffect(() => {
    let active = true;
    listGuardGroups()
      .then((list) => {
        if (!active) return;
        setGroups(list);
        setGroupsError("");
      })
      .catch((err) => {
        if (!active) return;
        setGroupsError(err?.message || "Couldn't load your groups.");
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load a group's settings + log on selection (or retry). The `active` flag
  // drops a slow response for a group that is no longer selected.
  useEffect(() => {
    if (!jid) return undefined;
    let active = true;
    Promise.all([
      getGuardSettings(jid),
      listModerationLog(jid, { limit: LOG_LIMIT }),
    ])
      .then(([saved, entries]) => {
        if (!active) return;
        const next = settingsToForm(saved);
        setSettings(next);
        setForm(next);
        setLogs(entries);
      })
      .catch((err) => {
        if (!active) return;
        setGroupError(err?.message || "Couldn't load this group's guards.");
        setSettings(null);
        setForm(null);
        setLogs([]);
      })
      .finally(() => {
        if (active) setGroupLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jid, reloadKey]);

  function chooseGroup(nextJid) {
    setJid(nextJid);
    setGroupLoading(true);
    setGroupError("");
    setSettings(null);
    setForm(null);
    setLogs([]);
    setJustSaved(false);
    setSaveError("");
    setHostInput("");
    setHostError("");
  }

  function retryGroup() {
    setGroupLoading(true);
    setGroupError("");
    setReloadKey((key) => key + 1);
  }

  // Prepend live moderation actions for the selected group.
  useInboxEventsListener((payload) => {
    if (payload?.type !== "guard" || !payload.entry) return;
    if (!jid || payload.jid !== jid) return;
    setLogs((prev) =>
      prev.some((entry) => entry.id === payload.entry.id)
        ? prev
        : [payload.entry, ...prev]
    );
  });

  function update(patch) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setJustSaved(false);
  }

  function addHost() {
    if (!form) return;
    const host = normalizeHost(hostInput);
    if (!host || !isValidHost(host)) {
      setHostError("Enter a domain like example.com.");
      return;
    }
    setHostError("");
    setHostInput("");
    if (form.linkWhitelist.includes(host)) return;
    update({ linkWhitelist: [...form.linkWhitelist, host] });
  }

  function removeHost(host) {
    if (!form) return;
    update({ linkWhitelist: form.linkWhitelist.filter((h) => h !== host) });
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await saveGuardSettings(jid, formToPayload(form));
      const next = settingsToForm(saved);
      setSettings(next);
      setForm(next);
      setJustSaved(true);
      setGroups((prev) =>
        prev.map((g) =>
          g.jid === jid
            ? { ...g, guarded: Boolean(next.linkGuard || next.toxicityGuard) }
            : g
        )
      );
    } catch (err) {
      setSaveError(err?.message || "Couldn't save guards.");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    if (settings) setForm(settings);
    setJustSaved(false);
  }

  const preview = renderWarnTemplate(form?.warnTemplate, {
    name: "Ada",
    mention: "@Ada",
    strikes: Number(form?.warnAt) || 1,
    kickAt: Number(form?.kickAt) || 0,
    reason: "link",
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader title="Guards" />

      {/* Group picker */}
      <Card>
        <CardHeader>
          <CardTitle>Group</CardTitle>
          <CardDescription>
            Only groups where you&apos;re an admin. Guard settings apply to one
            group at a time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groupsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading groups…
            </div>
          ) : groupsError ? (
            <div
              role="alert"
              className="space-y-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <p>{groupsError}</p>
              <Button size="sm" variant="outline" onClick={reloadGroups}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : groups.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              You&apos;re not an admin of any group. Ask to be made an admin,
              then reload.
            </p>
          ) : (
            <Select
              value={jid || null}
              onValueChange={chooseGroup}
              items={groups.map((g) => ({
                value: g.jid,
                label: groupOptionLabel(g),
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.jid} value={g.jid}>
                    {groupOptionLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {!jid ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <ShieldCheck className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No group selected</p>
            <p className="text-sm text-muted-foreground">
              Select a group to set its guards and see its moderation log.
            </p>
          </CardContent>
        </Card>
      ) : groupLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading guards…
          </CardContent>
        </Card>
      ) : groupError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">Couldn&apos;t load guards</p>
            <p className="text-sm text-muted-foreground">{groupError}</p>
            <Button variant="outline" onClick={retryGroup}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : form ? (
        <Tabs defaultValue="settings" key={jid}>
          <TabsList className="w-full">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="logs">Moderation log</TabsTrigger>
          </TabsList>

          {/* ---------------------------- Settings tab ---------------------------- */}
          <TabsContent value="settings" className="mt-4 space-y-4">
            {/* Link guard: gate + rules for unwanted links */}
            <Card>
              <CardHeader>
                <CardTitle>Link guard</CardTitle>
                <CardDescription>
                  Delete unwanted links, then warn repeat offenders and remove
                  them. Admins are never affected.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor="link-guard" className="flex-1 cursor-pointer">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Delete links</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Check every message for links and remove the offending
                        ones.
                      </span>
                    </span>
                  </Label>
                  <Switch
                    id="link-guard"
                    checked={form.linkGuard}
                    disabled={saving}
                    onCheckedChange={(checked) =>
                      update({ linkGuard: checked })
                    }
                  />
                </div>

                <div
                  className={cn(
                    "divide-y rounded-lg border",
                    !form.linkGuard && "opacity-50"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 p-3">
                    <Label
                      htmlFor="block-external"
                      className="flex-1 cursor-pointer"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">External URLs</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Delete any website link that isn&apos;t allowed below.
                        </span>
                      </span>
                    </Label>
                    <Switch
                      id="block-external"
                      disabled={!form.linkGuard || saving}
                      checked={form.blockExternal}
                      onCheckedChange={(checked) =>
                        update({ blockExternal: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3">
                    <Label
                      htmlFor="block-invites"
                      className="flex-1 cursor-pointer"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">
                          Other group invite links
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Delete invites to rival or unrelated groups.
                        </span>
                      </span>
                    </Label>
                    <Switch
                      id="block-invites"
                      disabled={!form.linkGuard || saving}
                      checked={form.blockInvites}
                      onCheckedChange={(checked) =>
                        update({ blockInvites: checked })
                      }
                    />
                  </div>
                </div>

                {/* Allowed hosts (whitelist) */}
                <div className="space-y-2">
                  <Label htmlFor="whitelist-host">Allowed links</Label>
                  <p className="text-xs text-muted-foreground">
                    Domains here are always allowed (subdomains included).
                    Everything else follows the rules above.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="whitelist-host"
                      value={hostInput}
                      placeholder="example.com"
                      disabled={saving}
                      onChange={(e) => {
                        setHostInput(e.target.value);
                        setHostError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addHost();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addHost}
                      disabled={saving || !hostInput.trim()}
                    >
                      <Plus className="size-4" />
                      Add
                    </Button>
                  </div>
                  {hostError ? (
                    <p className="text-sm text-destructive">{hostError}</p>
                  ) : null}
                  {form.linkWhitelist.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {form.linkWhitelist.map((host) => (
                        <span
                          key={host}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"
                        >
                          {host}
                          <button
                            type="button"
                            aria-label={`Remove ${host}`}
                            onClick={() => removeHost(host)}
                            disabled={saving}
                            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No allowed links yet — every link counts as external.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Toxicity */}
            <Card>
              <CardHeader>
                <CardTitle>Toxicity and bad words</CardTitle>
                <CardDescription>
                  Delete messages with bad language, then warn repeat offenders
                  and remove them. Independent of the link guard.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <Label
                    htmlFor="toxicity-guard"
                    className="flex-1 cursor-pointer"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Delete bad language
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Check every message against the wordlist below.
                      </span>
                    </span>
                  </Label>
                  <Switch
                    id="toxicity-guard"
                    checked={form.toxicityGuard}
                    disabled={saving}
                    onCheckedChange={(checked) =>
                      update({ toxicityGuard: checked })
                    }
                  />
                </div>

                <div
                  role="radiogroup"
                  aria-label="Sensitivity"
                  className={cn(
                    "grid grid-cols-3 gap-2",
                    !form.toxicityGuard && "opacity-50"
                  )}
                >
                  {SENSITIVITY_LEVELS.map((level) => (
                    <Button
                      key={level.id}
                      type="button"
                      role="radio"
                      aria-checked={form.sensitivity === level.id}
                      variant={
                        form.sensitivity === level.id ? "default" : "outline"
                      }
                      disabled={!form.toxicityGuard || saving}
                      onClick={() => update({ sensitivity: level.id })}
                    >
                      {level.label}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {sensitivityHint}
                </p>
              </CardContent>
            </Card>

            {/* Strikes + warning */}
            <Card>
              <CardHeader>
                <CardTitle>Strikes and warnings</CardTitle>
                <CardDescription>
                  Each deleted message adds a strike. Every offending message at
                  or past the warn strike gets a warning; at the kick strike the
                  member is removed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="warn-at">Warn at</Label>
                    <Input
                      id="warn-at"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.warnAt}
                      disabled={saving}
                      onChange={(e) => update({ warnAt: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kick-at">Kick at</Label>
                    <Input
                      id="kick-at"
                      type="number"
                      inputMode="numeric"
                      min={2}
                      value={form.kickAt}
                      disabled={saving}
                      onChange={(e) => update({ kickAt: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="warn-template">Warning message</Label>
                  <Textarea
                    id="warn-template"
                    rows={3}
                    value={form.warnTemplate}
                    placeholder={DEFAULT_WARN_TEMPLATE}
                    disabled={saving}
                    onChange={(e) => update({ warnTemplate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tokens:{" "}
                    {WARN_TEMPLATE_TOKENS.map((t) => (
                      <span key={t.token} title={t.hint} className="mr-2">
                        <code>{t.token}</code>
                      </span>
                    ))}
                  </p>
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                    Preview: {preview}
                  </p>
                </div>

                {validationError ? (
                  <p className="text-sm text-destructive">{validationError}</p>
                ) : (
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                    Warn on strike {form.warnAt} and remove from the group on
                    strike {form.kickAt}.
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={handleDiscard}
                    disabled={!dirty || saving}
                  >
                    Discard changes
                  </Button>
                  <Button onClick={handleSave} disabled={!canSave}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                </div>
                {saveError ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {saveError}
                  </p>
                ) : justSaved ? (
                  <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                    <Check className="size-4" />
                    Saved for {group ? groupLabel(group) : "this group"}.
                  </p>
                ) : null}
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ------------------------------ Logs tab ------------------------------ */}
          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Moderation log</CardTitle>
                <CardDescription>
                  Recent actions
                  {group ? ` in ${groupLabel(group)}` : ""}, newest first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                    No moderation actions yet. New actions will appear here as
                    they happen.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {logs.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 p-3"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={ACTION_VARIANT[entry.action] ?? "outline"}
                            >
                              {entry.action}
                            </Badge>
                            <span className="truncate text-sm">
                              {entry.reason}
                            </span>
                          </div>
                          <span className="truncate text-xs text-muted-foreground">
                            {entry.user || entry.actorJid || "Unknown"}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatWhen(entry.time)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
