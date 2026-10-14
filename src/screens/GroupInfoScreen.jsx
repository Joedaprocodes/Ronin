import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Check,
  Download,
  Loader2,
  MessageSquare,
  UserPlus,
  Users,
  WifiOff,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ScreenHeader from "@/components/ScreenHeader";
import { getGroupInfo, getList, listContacts } from "@/lib/api";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useContactsData } from "@/context/ContactsDataContext";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

// Created once: the locale is resolved by Intl, not hand-rolled.
const CREATED_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const FETCHED_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * A readable "last synced" label from the backend's `fetchedAt` (ISO-8601), or
 * null when there is no usable timestamp.
 */
function fetchedLabel(iso) {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : FETCHED_FMT.format(at);
}

/** First letters of the first two words, e.g. "Ada Lovelace" -> "AL". */
function initials(name) {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** Display rule from the contract: name ?? username ?? phone ?? id. */
function participantLabel(p) {
  return p.name || p.username || (p.phone ? `+${p.phone}` : "") || p.id;
}

/** The creator shows as "Owner"; other admins as "Admin". */
function isOwner(p, group) {
  if (p.admin === "superadmin") return true;
  return Boolean(
    group.owner && (p.id === group.owner || p.id === group.ownerPn)
  );
}

/** Formatted creation date, or null when absent/unparseable. */
function createdLabel(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : CREATED_FMT.format(date);
}

/** "12 hours" / "1 day" / null, from a duration in seconds. */
function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]) {
    if (seconds >= size) {
      const value = Math.round(seconds / size);
      return `${value} ${unit}${value === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

/* -------------------------------------------------------------------------- */
/*  CSV export                                                                */
/* -------------------------------------------------------------------------- */

/** Column order of the exported sheet. */
const CSV_HEADERS = ["Name", "Phone", "Role"];

/**
 * The Name column: display name, then @username, then blank when the Phone
 * column already identifies the row — and the id as a last resort, so a
 * LID-only member is never an anonymous line.
 */
function csvName(p) {
  return p.name || p.username || (p.phone ? "" : p.id || "");
}

/** "Owner" / "Admin" / "Member" — the same rule the list shows as a badge. */
function csvRole(p, group) {
  if (isOwner(p, group)) return "Owner";
  return p.admin ? "Admin" : "Member";
}

/** Header row + one row per participant, in WhatsApp's own order. */
function csvRows(participants, group) {
  return [
    CSV_HEADERS,
    ...participants.map((p) => [
      csvName(p),
      p.phone ? `+${p.phone}` : "",
      csvRole(p, group),
    ]),
  ];
}

/**
 * A tidy, collision-resistant filename: the subject slugified (ASCII) plus the
 * UTC date, so repeated exports of the same group never overwrite each other.
 */
function csvFilename(subject) {
  const slug = String(subject ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${slug || "group"}-participants-${date}.csv`;
}

/**
 * The name stored on a new contact: the resolved display name, then the
 * participant's @username, else blank (the number identifies the row). Mirrors
 * the CSV Name column so the address book and the sheet agree.
 */
function contactName(p) {
  return "";
}

/**
 * Import rows for the participants we can actually store as contacts: those
 * whose phone number WhatsApp resolved (LID-only members have none and are
 * skipped — a contact needs a real number).
 */
function contactRows(participants) {
  // Deduplicate by phone number to avoid adding the same contact twice
  const seenPhones = new Set();
  return (participants ?? [])
    .filter((p) => p.phone && !seenPhones.has(p.phone))
    .forEach((p) => seenPhones.add(p.phone))
    .map((p) => ({ name: contactName(p), phone: p.phone }));
  return (participants ?? [])
    .filter((p) => p.phone)
    .map((p) => ({ name: contactName(p), phone: p.phone }));
}

/** Friendly text for the statuses the group endpoint can return. */
function describeError(err) {
  switch (err?.status) {
    case 404:
      return "This group could not be found.";
    case 409:
    case 503:
      return "WhatsApp isn't connected, so group info can't be loaded right now.";
    case 502:
      return err?.message || "WhatsApp couldn't read this group's info.";
    default:
      return err?.message || "Couldn't load group info.";
  }
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Read-only group info, fetched live from WhatsApp via GET /api/groups/:jid.
 *
 * The endpoint needs an open connection, so 409/503 are surfaced as a friendly
 * "not connected" state (never a crash) and can be retried.
 */
export default function GroupInfoScreen() {
  const { jid } = useParams();
  const navigate = useNavigate();
  const { lists, importContacts, createList, updateList } = useContactsData();

  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [addingToList, setAddingToList] = useState(false);
  const [listResult, setListResult] = useState(null);
  const [listError, setListError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getGroupInfo(jid)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError({ status: 404, message: describeError({ status: 404 }) });
          return;
        }
        setGroup(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({ status: err?.status ?? 0, message: describeError(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jid, reloadToken]);

  // Reset in the handler (not the effect) so the retry doesn't setState
  // synchronously inside a render-triggered effect.
  function retry() {
    setGroup(null);
    setError(null);
    setLoading(true);
    setReloadToken((n) => n + 1);
  }

  const backTo = `/conversation/${encodeURIComponent(jid)}`;
  const participants = group?.participants ?? [];
  const count = group?.size || participants.length || 0;
  const title = group?.name?.trim() || "Group info";
  const subtitle = group
    ? `${count} ${count === 1 ? "participant" : "participants"}`
    : undefined;

  /** Download the currently listed participants as a CSV file. */
  function exportParticipants() {
    downloadCsv(csvFilename(group?.name), toCsv(csvRows(participants, group)));
  }

  /**
   * Saves every participant that has a resolved number into the address book,
   * then puts them all into a broadcast list titled after the group. A list
   * with that name already (e.g. one you pre-created) is reused and its
   * members are kept; otherwise a new list is created.
   */
  async function addParticipantsToList() {
    if (!group || addingToList) return;
    setListError("");
    setListResult(null);

    const rows = contactRows(participants);
    if (!rows.length) {
      setListError("No participant numbers to add.");
      return;
    }

    setAddingToList(true);
    try {
      await importContacts(rows);
      // Resolve each number to its stored contact id (existing or just added).
      const stored = await listContacts();
      const idByPhone = new Map(stored.map((c) => [c.phone, c.id]));
      const ids = [
        ...new Set(
          rows
            .map((r) => idByPhone.get(`+${String(r.phone).replace(/\D/g, "")}`))
            .filter(Boolean)
        ),
      ];

      const name = group.name?.trim() || "Group participants";
      const existing = lists.find(
        (l) => l.name.trim().toLowerCase() === name.toLowerCase()
      );

      let saved;
      if (existing) {
        const detail = await getList(existing.id);
        const merged = [...new Set([...(detail?.contactIds ?? []), ...ids])];
        saved = await updateList(existing.id, {
          name: existing.name,
          description: existing.description ?? "",
          contactIds: merged,
        });
      } else {
        saved = await createList({
          name,
          description: `Members of ${name}`,
          contactIds: ids,
        });
      }

      setListResult({
        id: saved?.id ?? existing?.id ?? null,
        name: saved?.name ?? name,
        count: ids.length,
        created: !existing,
      });
    } catch (err) {
      setListError(err?.message || "Couldn't add participants to a list.");
    } finally {
      setAddingToList(false);
    }
  }

  const created = createdLabel(group?.createdAt);
  const ephemeral = group ? humanDuration(group.ephemeralDuration) : null;
  const flags = group
    ? [
        group.announce ? "Admins only can message" : null,
        group.restrict ? "Admins only can edit info" : null,
        group.isCommunity ? "Community" : null,
      ].filter(Boolean)
    : [];
  const hasMeta = Boolean(created || ephemeral || flags.length);
  // Set when the backend served its stored snapshot instead of a live read
  // (socket offline, or a refresh failed) — worth telling the user about.
  const lastSynced = group ? fetchedLabel(group.fetchedAt) : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader
        back={backTo}
        avatar={
          <Avatar className="size-9">
            <AvatarFallback>
              <Users className="size-5" />
            </AvatarFallback>
          </Avatar>
        }
        title={title}
        subtitle={subtitle}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading group info…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm font-medium">Couldn&apos;t load group info</p>
          <p
            role="alert"
            className="max-w-sm text-sm text-muted-foreground"
          >
            {error.message}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => navigate("/inbox")}>
              Back to inbox
            </Button>
          </div>
        </div>
      ) : !group ? null : (
        <>
          {group.stale ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <WifiOff className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {lastSynced
                  ? `Showing saved group info from ${lastSynced}. WhatsApp isn't connected right now.`
                  : "Showing saved group info. WhatsApp isn't connected right now."}
              </span>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
              <CardDescription className="whitespace-pre-wrap">
                {group.description?.trim() || "No description."}
              </CardDescription>
            </CardHeader>

            {hasMeta ? (
              <CardContent className="space-y-3">
                {created || ephemeral ? (
                  <div className="space-y-2">
                    {created ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Created</span>
                        <span className="font-medium">{created}</span>
                      </div>
                    ) : null}
                    {ephemeral ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">
                          Disappearing messages
                        </span>
                        <span className="font-medium">{ephemeral}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {flags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {flags.map((flag) => (
                      <Badge key={flag} variant="secondary">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Participants</CardTitle>
              <CardDescription>
                {count} {count === 1 ? "member" : "members"}
              </CardDescription>
              {participants.length > 0 ? (
                <CardAction className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addParticipantsToList}
                    disabled={addingToList}
                  >
                    {addingToList ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    {addingToList ? "Adding…" : "Add to list"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportParticipants}
                  >
                    <Download className="size-4" />
                    Export CSV
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>

            <CardContent>
              {listError ? (
                <p role="alert" className="mb-3 text-xs text-destructive">
                  {listError}
                </p>
              ) : null}

              {listResult ? (
                <p
                  role="status"
                  className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Check className="size-3.5" />
                  {`Added ${listResult.count} ${
                    listResult.count === 1 ? "participant" : "participants"
                  } to ${
                    listResult.created ? "the new list " : ""
                  }“${listResult.name}”`}
                  {listResult.id ? (
                    <Link
                      to={`/contacts/lists/${listResult.id}`}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      View list
                    </Link>
                  ) : null}
                </p>
              ) : null}

              {participants.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center">
                  <Users className="size-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No participants listed.
                  </p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {participants.map((p) => {
                    const label = participantLabel(p);
                    const phoneLabel = p.phone ? `+${p.phone}` : null;
                    const secondary =
                      phoneLabel && phoneLabel !== label ? phoneLabel : null;
                    const owner = isOwner(p, group);

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          navigate(
                            `/conversation/${encodeURIComponent(p.id)}`,
                            { state: { name: label, isGroup: false } }
                          )
                        }
                        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/60"
                      >
                        <Avatar className="size-9">
                          <AvatarFallback>{initials(label)}</AvatarFallback>
                        </Avatar>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            {label}
                          </span>
                          {secondary ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {secondary}
                            </span>
                          ) : null}
                        </span>
                        {owner ? (
                          <Badge variant="secondary">Owner</Badge>
                        ) : p.admin ? (
                          <Badge variant="outline">Admin</Badge>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Button className="w-full" onClick={() => navigate(backTo)}>
            <MessageSquare className="size-4" />
            Message group
          </Button>
        </>
      )}
    </div>
  );
}
