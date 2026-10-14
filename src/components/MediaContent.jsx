import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import { mediaEmoji, mediaLabel } from "@/lib/media";

/**
 * Renders a stored media attachment inside a message bubble.
 *
 * The backend only returns a `media` field once it persists media and exposes
 * it as a URL (the Supabase public URL in production, or GET /api/media/:id for
 * the on-disk store); older servers omit it, so this component is only reached
 * for messages that actually carry media. A failed load (missing file, dead
 * URL) falls back to an attachment chip so the bubble is never empty.
 *
 * @param {object} props
 * @param {import("@/lib/api").MessageMedia} props.media
 */
export default function MediaContent({ media }) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(media?.url);

  if (!media || !src || failed) {
    return <AttachmentChip media={media} />;
  }

  if (media.type === "sticker") {
    return (
      <img
        src={src}
        alt={media.fileName || "Sticker"}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-32 object-contain"
      />
    );
  }

  if (media.type === "image") {
    return (
      <img
        src={src}
        alt={media.fileName || "Image"}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg object-contain"
      />
    );
  }

  if (media.type === "video") {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg bg-black/20"
      />
    );
  }

  if (media.type === "audio") {
    return (
      <audio
        src={src}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="w-64 max-w-full"
      />
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      download={media.fileName || undefined}
      className="flex items-center gap-2 py-0.5 underline-offset-4 hover:underline"
    >
      <FileText className="size-4 shrink-0" />
      <span className="truncate">{media.fileName || "Document"}</span>
      <Download className="size-4 shrink-0 opacity-70" />
    </a>
  );
}

/**
 * Fallback shown when a message has media metadata but the bytes aren't
 * available yet, or the file failed to load.
 *
 * @param {object} props
 * @param {import("@/lib/api").MessageMedia} [props.media]
 */
function AttachmentChip({ media }) {
  return (
    <span className="flex items-center gap-2 py-0.5">
      <span aria-hidden className="text-base leading-none">
        {mediaEmoji(media?.type)}
      </span>
      <span className="truncate">{media?.fileName || mediaLabel(media?.type)}</span>
    </span>
  );
}
