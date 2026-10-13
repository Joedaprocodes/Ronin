import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  Contact as ContactIcon,
  EllipsisVertical,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ScreenHeader from "@/components/ScreenHeader";
import ImportContactsSheet from "@/components/ImportContactsSheet";
import { getList } from "@/lib/api";
import { useContactsData } from "@/context/ContactsDataContext";
import { cn, formatDigits } from "@/lib/utils";

/**
 * The Contacts tab and the Lists tab, sharing one header.
 *
 * The active tab lives in the URL (`?tab=lists`) so the Broadcasts screen (and
 * deep links) can point straight at the lists, mirroring how Broadcasts keeps
 * its Templates tab in `?tab=templates`.
 */

function initials(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** A contact's display name, falling back to the formatted number. */
function contactName(contact) {
  return contact.name?.trim() || formatDigits(contact.phone) || "Unknown";
}

/* -------------------------------------------------------------------------- */
/*  Shared bits                                                               */
/* -------------------------------------------------------------------------- */

function LoadingBlock({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <p role="alert" className="text-sm font-medium">
        Couldn&apos;t load your contacts
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Try again
      </Button>
    </div>
  );
}

/**
 * The trailing "…" menu on a row. Rendered outside the row's <Link> so its
 * button never nests inside an anchor.
 */
function RowMenu({ onEdit, onDelete }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More actions"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <EllipsisVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function ContactsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "lists" ? "lists" : "contacts";
  const navigate = useNavigate();

  const {
    contacts,
    lists,
    loading,
    error,
    refresh,
    deleteContact,
    deleteContacts,
    deleteList,
    updateList,
  } = useContactsData();

  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  // One confirm dialog serves both tabs: `{ kind, item }` or null.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Multi-select (contacts tab only). `listPickerMode` is null | "add" | "remove".
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingListId, setApplyingListId] = useState(null);
  const [listPickerMode, setListPickerMode] = useState(null);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [contacts, query]);

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      if (pendingDelete.kind === "contact") {
        await deleteContact(pendingDelete.item.id);
      } else {
        await deleteList(pendingDelete.item.id);
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err?.message || "Couldn't delete. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  function closeDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError("");
  }

  const deleteLabel = pendingDelete
    ? pendingDelete.kind === "contact"
      ? contactName(pendingDelete.item)
      : pendingDelete.item.name
    : "";

  /* ----------------------------- Multi-select ----------------------------- */

  function startSelecting() {
    setBulkError("");
    setSelecting(true);
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelecting(false);
    setSelectedIds(new Set());
    setBulkConfirm(false);
    setListPickerMode(null);
    setBulkError("");
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
  }

  function openBulkDelete() {
    setBulkError("");
    setBulkConfirm(true);
  }

  function openListPicker(mode) {
    setBulkError("");
    setListPickerMode(mode);
  }

  async function confirmBulkDelete() {
    if (busy || selectedIds.size === 0) return;
    setBusy(true);
    setBulkError("");
    try {
      await deleteContacts([...selectedIds]);
      exitSelection();
    } catch (err) {
      setBulkError(err?.message || "Couldn't delete. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function applyListMembership(listId) {
    if (busy || selectedIds.size === 0 || !listPickerMode) return;
    setBusy(true);
    setApplyingListId(listId);
    setBulkError("");
    try {
      // PUT replaces the whole membership, so read the current members first
      // and send the union (add) or difference (remove).
      const detail = await getList(listId);
      if (!detail) throw new Error("This list no longer exists.");
      const current = new Set(detail.contactIds ?? []);
      if (listPickerMode === "add") {
        for (const id of selectedIds) current.add(id);
      } else {
        for (const id of selectedIds) current.delete(id);
      }
      await updateList(listId, {
        name: detail.name,
        description: detail.description ?? "",
        contactIds: [...current],
      });
      exitSelection();
    } catch (err) {
      setBulkError(err?.message || "Couldn't update the list. Try again.");
    } finally {
      setBusy(false);
      setApplyingListId(null);
    }
  }

  /** Open (or start) the chat with a contact, addressed by their phone JID. */
  function openChat(contact) {
    const digits = String(contact.phone ?? "").replace(/\D/g, "");
    if (!digits) return;
    navigate(`/conversation/${encodeURIComponent(`${digits}@s.whatsapp.net`)}`, {
      state: { name: contactName(contact), isGroup: false },
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          // Selection is scoped to the Contacts tab; leaving it drops the selection.
          if (value !== "contacts") exitSelection();
          setSearchParams(value === "contacts" ? {} : { tab: value });
        }}
      >
        <ScreenHeader
          title="Contacts"
          className="mb-4"
          action={
            tab === "contacts" ? (
              selecting ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel selection"
                  onClick={exitSelection}
                >
                  <X className="size-4" />
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  {contacts.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Select contacts"
                      onClick={startSelecting}
                    >
                      <ListChecks className="size-4" />
                    </Button>
                  ) : null}
                  <Link
                    to="/contacts/new"
                    aria-label="Add contact"
                    className={buttonVariants({ variant: "ghost", size: "icon" })}
                  >
                    <Plus className="size-4" />
                  </Link>
                </div>
              )
            ) : (
              <Link
                to="/contacts/lists/new"
                aria-label="New list"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <Plus className="size-4" />
              </Link>
            )
          }
        >
          <TabsList className="w-full mb-3">
            <TabsTrigger value="contacts">
              Contacts ({contacts.length})
            </TabsTrigger>
            <TabsTrigger value="lists">Lists ({lists.length})</TabsTrigger>
          </TabsList>

          {tab === "contacts" && (
            <div className="flex gap-2 pb-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search contacts"
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                disabled={loading || Boolean(error)}
              >
                <Upload className="size-4" />
                Import
              </Button>
            </div>
          )}
        </ScreenHeader>

        {/* ------------------------------ Contacts ------------------------------ */}
        <TabsContent value="contacts" className="mt-4 space-y-4">
          {selecting && !loading && !error ? (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {selectedIds.size} selected
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllFiltered}
                    disabled={busy || filteredContacts.length === 0}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={busy || selectedIds.size === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openListPicker("add")}
                  disabled={busy || selectedIds.size === 0}
                >
                  <UserPlus className="size-4" />
                  Add to list
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openListPicker("remove")}
                  disabled={busy || selectedIds.size === 0}
                >
                  <UserMinus className="size-4" />
                  Remove from list
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={openBulkDelete}
                  disabled={busy || selectedIds.size === 0}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <LoadingBlock label="Loading contacts…" />
          ) : error ? (
            <ErrorBlock
              message={error.message || "Something went wrong."}
              onRetry={refresh}
            />
          ) : filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <p className="text-sm font-medium">
                {query.trim() ? "No contacts match your search." : "No contacts yet."}
              </p>
              {!query.trim() && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    to="/contacts/new"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Plus className="size-4" />
                    Add contact
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="size-4" />
                    Import
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {filteredContacts.map((c) => {
                const named = Boolean(c.name?.trim());
                const isSelected = selectedIds.has(c.id);
                const rowBody = (
                  <>
                    {selecting ? (
                      isSelected ? (
                        <CheckCircle2 className="size-5 shrink-0 text-primary" />
                      ) : (
                        <Circle className="size-5 shrink-0 text-muted-foreground" />
                      )
                    ) : null}
                    <Avatar className="size-11">
                      <AvatarFallback>
                        {named ? (
                          initials(c.name)
                        ) : (
                          <ContactIcon className="size-5" />
                        )}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {contactName(c)}
                      </p>
                      {named && c.phone ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDigits(c.phone)}
                        </p>
                      ) : null}
                    </div>
                  </>
                );

                return (
                  <div
                    key={c.id}
                    aria-selected={selecting ? isSelected : undefined}
                    className={cn(
                      "flex items-center gap-2 p-3 transition-colors",
                      isSelected ? "bg-muted/60" : "hover:bg-muted/60"
                    )}
                  >
                    {selecting ? (
                      <button
                        type="button"
                        onClick={() => toggleSelected(c.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {rowBody}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openChat(c)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {rowBody}
                      </button>
                    )}

                    {selecting ? null : (
                      <RowMenu
                        onEdit={() => navigate(`/contacts/${c.id}`)}
                        onDelete={() =>
                          setPendingDelete({ kind: "contact", item: c })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* -------------------------------- Lists -------------------------------- */}
        <TabsContent value="lists" className="mt-4 space-y-4">
          {loading ? (
            <LoadingBlock label="Loading lists…" />
          ) : error ? (
            <ErrorBlock
              message={error.message || "Something went wrong."}
              onRetry={refresh}
            />
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <Users className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No lists yet — create one.</p>
              <Link to="/contacts/lists/new" className={buttonVariants()}>
                <Plus className="size-4" />
                New list
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {lists.map((list) => (
                <div
                  key={list.id}
                  className="group relative rounded-xl border bg-card transition-colors hover:bg-muted/50"
                >
                  <Link
                    to={`/contacts/lists/${list.id}`}
                    className="flex h-full flex-col gap-1 p-4"
                  >
                    <span className="flex items-center gap-2">
                      <Users className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">
                        {list.name}
                      </span>
                    </span>
                    {list.description ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {list.description}
                      </span>
                    ) : null}
                    <span className="mt-auto pt-2 text-xs text-muted-foreground">
                      {list.memberCount}{" "}
                      {list.memberCount === 1 ? "contact" : "contacts"}
                    </span>
                  </Link>

                  <div className="absolute right-2 top-2">
                    <RowMenu
                      onEdit={() => navigate(`/contacts/lists/${list.id}`)}
                      onDelete={() =>
                        setPendingDelete({ kind: "list", item: list })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {importOpen && (
        <ImportContactsSheet onClose={() => setImportOpen(false)} />
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {pendingDelete?.kind === "list" ? "list" : "contact"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "list"
                ? `"${deleteLabel}" will be removed. The contacts in it are kept.`
                : `"${deleteLabel}" will be removed from every list.`}
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

      {/* Bulk-delete confirmation for the current selection. */}
      <AlertDialog
        open={bulkConfirm}
        onOpenChange={(open) => {
          if (!open && !busy) setBulkConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size}{" "}
              {selectedIds.size === 1 ? "contact" : "contacts"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be removed from every list. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bulkError ? (
            <p role="alert" className="text-sm text-destructive">
              {bulkError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmBulkDelete();
              }}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add/Remove the selection from a list (PUT replaces the membership). */}
      <Sheet
        open={listPickerMode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setListPickerMode(null);
            setBulkError("");
          }
        }}
      >
        <SheetContent side="bottom" className="max-h-[80svh]">
          <SheetHeader>
            <SheetTitle>
              {listPickerMode === "add" ? "Add to list" : "Remove from list"}
            </SheetTitle>
            <SheetDescription>
              {selectedIds.size}{" "}
              {selectedIds.size === 1 ? "contact" : "contacts"} selected.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4">
            {lists.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center">
                <Users className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No lists yet.</p>
                <Link
                  to="/contacts/lists/new"
                  onClick={() => setListPickerMode(null)}
                  className="text-sm underline underline-offset-4 hover:text-foreground"
                >
                  Create a list
                </Link>
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => applyListMembership(list.id)}
                    disabled={busy}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {list.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {list.memberCount}{" "}
                        {list.memberCount === 1 ? "contact" : "contacts"}
                      </span>
                    </span>
                    {applyingListId === list.id ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}

            {bulkError ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {bulkError}
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
