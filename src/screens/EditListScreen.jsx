import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Search, Trash2, Users } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ScreenHeader from "@/components/ScreenHeader";
import { getList } from "@/lib/api";
import { useContactsData } from "@/context/ContactsDataContext";
import { formatDigits } from "@/lib/utils";

const BACK_TO_LISTS = "/contacts?tab=lists";

function contactName(contact) {
  return contact.name?.trim() || formatDigits(contact.phone) || "Unknown";
}

/**
 * Create ("new") or edit a broadcast list: a name, an optional description and
 * the set of contacts it broadcasts to.
 */
export default function EditListScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = id === "new";

  const { contacts, createList, updateList, deleteList } = useContactsData();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contactIds, setContactIds] = useState([]);

  const [loading, setLoading] = useState(!isCreate);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [memberQuery, setMemberQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isCreate) return undefined;

    let cancelled = false;

    getList(id)
      .then((list) => {
        if (cancelled) return;
        if (!list) {
          setNotFound(true);
          return;
        }
        setName(list.name ?? "");
        setDescription(list.description ?? "");
        setContactIds(Array.isArray(list.contactIds) ? list.contactIds : []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) setNotFound(true);
        else setLoadError(err?.message || "Couldn't load this list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  const selected = useMemo(() => new Set(contactIds), [contactIds]);

  const filteredMembers = useMemo(() => {
    const sorted = [...contacts].sort((a, b) =>
      contactName(a).localeCompare(contactName(b))
    );
    const q = memberQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) =>
      [c.name, c.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [contacts, memberQuery]);

  function toggleMember(memberId, checked) {
    setContactIds((prev) => {
      if (checked) return prev.includes(memberId) ? prev : [...prev, memberId];
      return prev.filter((x) => x !== memberId);
    });
  }

  const canSave = name.trim() !== "" && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");

    const input = {
      name: name.trim(),
      description: description.trim(),
      contactIds,
    };

    try {
      if (isCreate) await createList(input);
      else await updateList(id, input);
      navigate(BACK_TO_LISTS);
    } catch (err) {
      setSaveError(err?.message || "Couldn't save list");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setSaveError("");
    try {
      await deleteList(id);
      navigate(BACK_TO_LISTS);
    } catch (err) {
      setSaveError(err?.message || "Couldn't delete list");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="List" back={BACK_TO_LISTS} />
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading list…
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="List not found" back={BACK_TO_LISTS} />
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-medium">List not found</p>
          <Link
            to={BACK_TO_LISTS}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Back to lists
          </Link>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="List" back={BACK_TO_LISTS} />
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Couldn&apos;t load this list</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Link
            to={BACK_TO_LISTS}
            className="text-sm underline underline-offset-4 hover:text-foreground"
          >
            Back to lists
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader
        title={isCreate ? "New list" : "Edit list"}
        back={BACK_TO_LISTS}
      />

      <Card>
        <CardHeader>
          <CardTitle>List details</CardTitle>
          <CardDescription>
            This name shows up as an audience when you build a broadcast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Automotive Leads"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="list-description">Description (optional)</Label>
            <Textarea
              id="list-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What this list is for…"
              disabled={saving}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {contactIds.length}{" "}
            {contactIds.length === 1 ? "contact" : "contacts"} selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="Search contacts"
              className="pl-9"
              disabled={saving}
            />
          </div>

          {contacts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center">
              <Users className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No contacts yet. Add some first.
              </p>
              <Link
                to="/contacts/new"
                className="text-sm underline underline-offset-4 hover:text-foreground"
              >
                Add a contact
              </Link>
            </div>
          ) : filteredMembers.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No contacts match “{memberQuery.trim()}”.
            </p>
          ) : (
            <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {filteredMembers.map((c) => {
                const memberId = c.id;
                return (
                  <div
                    key={memberId}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <Label
                      htmlFor={`member-${memberId}`}
                      className="flex-1 cursor-pointer"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {contactName(c)}
                        </span>
                        {c.phone ? (
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {formatDigits(c.phone)}
                          </span>
                        ) : null}
                      </span>
                    </Label>
                    <Switch
                      id={`member-${memberId}`}
                      checked={selected.has(memberId)}
                      onCheckedChange={(checked) =>
                        toggleMember(memberId, checked)
                      }
                      disabled={saving}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {saveError ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {saveError}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate(BACK_TO_LISTS)}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={!canSave || deleting}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isCreate ? "Create list" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>

      {!isCreate ? (
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving || deleting}
        >
          <Trash2 className="size-4" />
          Delete list
        </Button>
      ) : null}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this list?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{name.trim() || "This list"}&rdquo; will be removed. The
              contacts in it are kept. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
