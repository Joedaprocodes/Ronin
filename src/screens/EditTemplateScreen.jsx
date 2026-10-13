import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, PaperclipIcon, Trash2, XIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import ScreenHeader from "@/components/ScreenHeader";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  updateTemplate,
} from "@/lib/api";
import {
  MAX_MEDIA_BYTES,
  fileToBase64,
  formatBytes,
  getMediaType,
  mediaEmoji,
  mediaLabel,
} from "@/lib/media";

const BACK_TO_TEMPLATES = "/broadcasts?tab=templates";

/**
 * Create ("new") or edit a broadcast template.
 *
 * The attachment state is tracked explicitly so the save payload is
 * deterministic: "none"/"cleared" send no media, "new" replaces/adds it, and
 * "saved" (an untouched existing attachment) omits `media` = keep it.
 *
 * @typedef {Object} PendingAttachment
 * @property {string} name
 * @property {number} size
 * @property {"image" | "video" | "audio" | "document"} type
 * @property {import("@/lib/api").SendMedia} media
 */

export default function EditTemplate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = id === "new";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fallbackName, setFallbackName] = useState("");

  const [loading, setLoading] = useState(!isCreate);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [savedMedia, setSavedMedia] = useState(null);
  // "none" | "saved" | "new" | "cleared" — see the payload rules in handleSave.
  const [attachmentMode, setAttachmentMode] = useState("none");
  // A picked file, only when attachmentMode is "new".
  /** @type {[PendingAttachment | null, Function]} */
  const [attachment, setAttachment] = useState(null);
  const [fileError, setFileError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef(null);

  // Edit mode loads the existing template (create mode skips straight to form).
  useEffect(() => {
    if (isCreate) return undefined;

    let cancelled = false;

    getTemplate(id)
      .then((template) => {
        if (cancelled) return;
        if (!template) {
          setNotFound(true);
          return;
        }
        setTitle(template.title ?? "");
        setBody(template.body ?? "");
        setFallbackName(template.fallbackName ?? "");
        const media = template.media ?? null;
        setSavedMedia(media);
        setAttachmentMode(media ? "saved" : "none");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) setNotFound(true);
        else setLoadError(err?.message || "Couldn't load this template.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFilePick(file) {
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) {
      setFileError("File is too large (max 20 MB)");
      return;
    }

    fileToBase64(file)
      .then(({ data, mimeType }) => {
        const type = getMediaType(file.type);
        /** @type {import("@/lib/api").SendMedia} */
        const media = { type, data, mimeType: mimeType || file.type };
        // Documents must carry a filename for the backend to label them.
        if (type === "document") media.fileName = file.name;

        setAttachment({
          name: file.name,
          size: file.size,
          type,
          media,
        });
        setAttachmentMode("new");
        setFileError("");
      })
      .catch(() => {
        setFileError("Failed to read file");
      });
  }

  function removeAttachment() {
    setAttachment(null);
    setAttachmentMode("none");
  }

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || saving) return;

    setSaving(true);
    setSaveError("");

    /** @type {import("@/lib/api").TemplateInput} */
    const input = { title: trimmedTitle, body: body.trim(), fallbackName: fallbackName.trim() };
    if (attachmentMode === "new" && attachment?.media) {
      input.media = attachment.media;
    } else if (attachmentMode === "cleared") {
      input.media = null; // keep omitted when a saved attachment is untouched
    }

    try {
      if (isCreate) await createTemplate(input);
      else await updateTemplate(id, input);
      navigate(BACK_TO_TEMPLATES);
    } catch (err) {
      // Keep the form (and the attachment) so the user can retry.
      setSaveError(err?.message || "Couldn't save template");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setSaveError("");

    try {
      await deleteTemplate(id);
      navigate(BACK_TO_TEMPLATES);
    } catch (err) {
      setSaveError(err?.message || "Couldn't delete template");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const canSave = title.trim() !== "" && !saving;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Edit template" back={BACK_TO_TEMPLATES} />
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading template…
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Template not found" back={BACK_TO_TEMPLATES} />

        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-medium">Template not found</p>
          <Link
            to={BACK_TO_TEMPLATES}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Back to templates
          </Link>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader title="Edit template" back={BACK_TO_TEMPLATES} />

        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Couldn't load this template</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Link
            to={BACK_TO_TEMPLATES}
            className="text-sm underline underline-offset-4 hover:text-foreground"
          >
            Back to templates
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader
        title={isCreate ? "New template" : "Edit template"}
        back={BACK_TO_TEMPLATES}
      />

      <Card>
        <CardHeader>
          <CardTitle>Template details</CardTitle>
          <CardDescription>
            The title is what you pick in the broadcast dropdown.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-title">Title</Label>
            <Input
              id="template-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly Promo"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-body">Message</Label>
            <Textarea
              id="template-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Hi {{name}} or {{full_name}}, write the message… (optional for a media-only template)"
              disabled={saving}
            />
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Personalize with{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  {"{{full_name}}"}
                </code>{" "}
                for the contact&rsquo;s full name, or{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                  {"{{name}}"}
                </code>{" "}
                for their first name (everything before the first space). Each is
                filled in per recipient when the broadcast sends.
              </p>
              <p className="shrink-0 text-xs text-muted-foreground">
                {body.length} characters
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-fallback-name">Fallback name</Label>
            <Input
              id="template-fallback-name"
              value={fallbackName}
              onChange={(e) => setFallbackName(e.target.value)}
              placeholder="e.g. there"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Used when a contact has no name, so{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                {"{{name}}"}
              </code>{" "}
              never greets them blank. If this is empty too, the phone number is
              used instead.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Attachment</Label>

            {attachmentMode === "new" && attachment ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <span aria-hidden className="text-base leading-none">
                  {mediaEmoji(attachment.type)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {attachment.name || mediaLabel(attachment.type)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove attachment"
                  onClick={removeAttachment}
                  disabled={saving}
                >
                  <XIcon />
                </Button>
              </div>
            ) : attachmentMode === "saved" && savedMedia ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <span aria-hidden className="text-base leading-none">
                  {mediaEmoji(savedMedia.type)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {savedMedia.fileName || mediaLabel(savedMedia.type)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={openFilePicker}
                  disabled={saving}
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove attachment"
                  onClick={() => setAttachmentMode("cleared")}
                  disabled={saving}
                >
                  <XIcon />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openFilePicker}
                disabled={saving}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Add an attachment</span>
                  <span className="text-xs text-muted-foreground">
                    Image, video, audio or document — up to 20 MB. Optional.
                  </span>
                </span>
              </button>
            )}

            {fileError ? (
              <p role="alert" className="text-sm text-destructive">
                {fileError}
              </p>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleFilePick(file);
              // Reset so picking the same file again still fires onChange.
              event.target.value = "";
            }}
          />

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
            onClick={() => navigate(BACK_TO_TEMPLATES)}
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
            {isCreate ? "Create template" : "Save changes"}
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
          Delete template
        </Button>
      ) : null}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &ldquo;{title.trim() || "this template"}
              &rdquo;. Broadcasts already scheduled with it aren&apos;t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the delete finishes
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
