import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createTemplate, mediaUrl } from "@/lib/api";
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_LABEL,
  formatBytes,
  getMediaType,
  mediaEmoji,
  mediaLabel,
} from "@/lib/media";
import { mentionsName, personaliseName, restoreName } from "@/lib/templates";

const MAX_TITLE = 200; // mirrors the backend's MAX_TITLE_LENGTH
const MAX_BODY = 4096; // WhatsApp's text limit
const TITLE_PREVIEW = 80;

/**
 * A starting title from the message: its first non-empty line, collapsed to
 * single spaces and clipped. Media-only messages fall back to the bucket name.
 *
 * @param {import("@/lib/api").MessageView} [message]
 * @returns {string}
 */
function defaultTitle(message) {
  const text = (message?.text ?? "").trim();
  const line = text.split("\n").find((part) => part.trim()) ?? "";
  const collapsed = line.trim().replace(/\s+/g, " ");
  if (!collapsed) return `${mediaLabel(message?.media?.type)} template`;
  return collapsed.length > TITLE_PREVIEW
    ? `${collapsed.slice(0, TITLE_PREVIEW).trimEnd()}…`
    : collapsed;
}

/** Read a Blob into a data: URL (the shape the API's SendMedia expects). */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read the attachment"));
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read the attachment"));
    reader.readAsDataURL(blob);
  });
}

/**
 * A message's stored attachment, re-read as the upload shape a template takes.
 * The bytes are fetched from the (CORS-open) media route or the public bucket.
 *
 * @param {import("@/lib/api").MessageMedia} media
 * @returns {Promise<import("@/lib/api").SendMedia>}
 */
async function readMedia(media) {
  const url = mediaUrl(media?.url);
  if (!url) throw new Error("This attachment isn't available to copy");

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error("Couldn't read the attachment — check your connection", {
      cause: err,
    });
  }
  if (!res.ok) throw new Error("Couldn't read the attachment from the server");

  const blob = await res.blob();
  if (blob.size > MAX_MEDIA_BYTES) {
    throw new Error(
      `That attachment is ${formatBytes(blob.size)} — over the ${MAX_MEDIA_LABEL} limit`
    );
  }

  // `blob.type` can come back empty from some stores; the stored mimeType is
  // the next best thing.
  const mimeType = blob.type || media.mimeType || undefined;
  return {
    type: media.type || getMediaType(mimeType),
    data: await blobToDataUrl(blob),
    mimeType,
    fileName: media.fileName || undefined,
  };
}

/**
 * "Save as template" — copies a message (text, and optionally its attachment)
 * into a broadcast template, so it can be reused later.
 *
 * The parent remounts this on every open (see the `key` it passes), so state is
 * initialised from `message` and never leaks between messages.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {import("@/lib/api").MessageView | null} props.message
 * @param {string} props.contactName
 * @param {(template: import("@/lib/api").Template | null) => void} [props.onSaved]
 */
export default function SaveAsTemplateDialog({
  open,
  onOpenChange,
  message,
  contactName,
  onSaved,
}) {
  const [title, setTitle] = useState(() => defaultTitle(message));
  const [body, setBody] = useState(() => message?.text ?? "");
  const [includeMedia, setIncludeMedia] = useState(() => Boolean(message?.media));
  const [personalise, setPersonalise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const media = message?.media ?? null;
  const keepMedia = Boolean(includeMedia && media);
  const canSave = Boolean(title.trim()) && (Boolean(body.trim()) || keepMedia);
  // The toggle only makes sense when the message actually names the contact.
  const canPersonalise = mentionsName(message?.text ?? "", contactName);

  function togglePersonalise(checked) {
    setPersonalise(checked);
    setBody((current) =>
      checked ? personaliseName(current, contactName) : restoreName(current, contactName)
    );
  }

  async function save() {
    if (busy) return;
    if (!title.trim()) return setError("Give the template a title.");
    if (!body.trim() && !keepMedia) {
      return setError("Add some text or keep the attachment.");
    }

    setBusy(true);
    setError("");
    try {
      const template = await createTemplate({
        title: title.trim(),
        body: body.trim(),
        media: keepMedia ? await readMedia(media) : undefined,
      });
      onSaved?.(template);
    } catch (err) {
      setError(err?.message || "Couldn't save the template");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save as template</AlertDialogTitle>
          <AlertDialogDescription>
            Reuse this in a broadcast later; find it under Broadcasts →
            Templates.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="template-title">Title</Label>
            <Input
              id="template-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_TITLE}
              placeholder="e.g. Restock notice"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="template-body">Message</Label>
            <Textarea
              id="template-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={MAX_BODY}
              placeholder={media ? "Optional caption" : "Message text"}
            />
          </div>

          {media ? (
            <div className="rounded-lg border p-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="template-media" className="font-medium">
                  Include the attachment
                </Label>
                <Switch
                  id="template-media"
                  checked={includeMedia}
                  onCheckedChange={setIncludeMedia}
                  className="shrink-0"
                />
              </div>
              <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="text-base leading-none">
                  {mediaEmoji(media.type)}
                </span>
                <span className="truncate">
                  {media.fileName || mediaLabel(media.type)}
                </span>
              </p>
            </div>
          ) : null}

          {canPersonalise ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-2">
              <div className="min-w-0">
                <Label htmlFor="template-personalise" className="font-medium">
                  Personalise with {contactName}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Sends as {'{{name}}'} so each recipient sees their own name
                </p>
              </div>
              <Switch
                id="template-personalise"
                checked={personalise}
                onCheckedChange={togglePersonalise}
                className="shrink-0"
              />
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {'{{name}}'} and {'{{full_name}}'} are filled in per recipient when a
            broadcast sends this.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              save();
            }}
            disabled={busy || !canSave}
          >
            {busy ? "Saving…" : "Save template"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
