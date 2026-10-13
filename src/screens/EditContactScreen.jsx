import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Loader2, Trash2, Users } from "lucide-react";
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
import ScreenHeader from "@/components/ScreenHeader";
import CountryCodeInput from "@/components/CountryCodeInput";
import { getContact, listContactLists } from "@/lib/api";
import { normalizePhone } from "@/lib/utils";
import { useContactsData } from "@/context/ContactsDataContext";
import { usePhonePreferences } from "@/context/PhonePreferencesContext";

const BACK_TO_CONTACTS = "/contacts";

/**
 * Create ("new") or edit a single contact.
 *
 * The record is loaded with GET /api/contacts/:id so a deep link works even on
 * a cold start; saving goes through the shared contacts store so the list and
 * any list membership counts stay in step.
 */
export default function EditContactScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = id === "new";

  const { createContact, updateContact, deleteContact } = useContactsData();
  const { countryCode } = usePhonePreferences();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(!isCreate);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Which broadcast lists this contact belongs to (read-only, existing contacts).
  const [contactLists, setContactLists] = useState([]);
  const [listsLoading, setListsLoading] = useState(!isCreate);
  const [listsError, setListsError] = useState("");

  useEffect(() => {
    if (isCreate) return undefined;

    let cancelled = false;

    getContact(id)
      .then((contact) => {
        if (cancelled) return;
        if (!contact) {
          setNotFound(true);
          return;
        }
        setName(contact.name ?? "");
        setPhone(contact.phone ?? "");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) setNotFound(true);
        else setLoadError(err?.message || "Couldn't load this contact.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  // Membership is a separate concern from the contact itself; load it in
  // parallel so a failure here doesn't blank the form.
  useEffect(() => {
    if (isCreate) return undefined;

    let cancelled = false;

    listContactLists(id)
      .then((lists) => {
        if (cancelled) return;
        setContactLists(lists);
      })
      .catch((err) => {
        if (cancelled) return;
        setListsError(err?.message || "Couldn't load lists.");
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  const normalizedPhone = normalizePhone(phone, countryCode);
  const canSave = normalizedPhone.replace(/\D/g, "").length >= 7 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");

    const input = { name: name.trim(), phone: normalizedPhone };

    try {
      if (isCreate) await createContact(input);
      else await updateContact(id, input);
      navigate(BACK_TO_CONTACTS);
    } catch (err) {
      // Keep the form so the user can fix and retry.
      setSaveError(err?.message || "Couldn't save contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setSaveError("");
    try {
      await deleteContact(id);
      navigate(BACK_TO_CONTACTS);
    } catch (err) {
      setSaveError(err?.message || "Couldn't delete contact");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Contact" back={BACK_TO_CONTACTS} />
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading contact…
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Contact not found" back={BACK_TO_CONTACTS} />
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-medium">Contact not found</p>
          <Link
            to={BACK_TO_CONTACTS}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Back to contacts
          </Link>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Contact" back={BACK_TO_CONTACTS} />
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Couldn&apos;t load this contact</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Link
            to={BACK_TO_CONTACTS}
            className="text-sm underline underline-offset-4 hover:text-foreground"
          >
            Back to contacts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader
        title={isCreate ? "New contact" : "Edit contact"}
        back={BACK_TO_CONTACTS}
      />

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
          <CardDescription>
            Add the country code, or type a local number and we&apos;ll apply it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name (optional)</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ada Lovelace"
              autoComplete="name"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone number</Label>
            <div className="flex gap-2">
              <CountryCodeInput
                id="contact-country-code"
                aria-label="Country code"
                className="w-20 shrink-0"
                disabled={saving}
              />
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() =>
                  setPhone((current) => normalizePhone(current, countryCode))
                }
                placeholder="805 292 8072"
                disabled={saving}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Numbers without a country code are saved as +{countryCode}.
            </p>
          </div>

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
            onClick={() => navigate(BACK_TO_CONTACTS)}
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
            {isCreate ? "Create contact" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>

      {!isCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Lists</CardTitle>
            <CardDescription>
              Broadcast lists that include this contact.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {listsLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading lists…
              </div>
            ) : listsError ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {listsError}
              </p>
            ) : contactLists.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center">
                <Users className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  This contact isn&apos;t in any list yet.
                </p>
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {contactLists.map((list) => (
                  <Link
                    key={list.id}
                    to={`/contacts/lists/${list.id}`}
                    className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/60"
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
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isCreate ? (
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving || deleting}
        >
          <Trash2 className="size-4" />
          Delete contact
        </Button>
      ) : null}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{name.trim() || phone.trim() || "This contact"}&rdquo; will
              be removed from every list. This can&apos;t be undone.
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
