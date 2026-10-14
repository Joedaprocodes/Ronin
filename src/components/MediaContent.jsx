import { useState } from "react";
import { Download, FileText, Play } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import { mediaEmoji, mediaLabel } from "@/lib/media";
import { useInView } from "@/hooks/useInView";

/**
 * Renders a stored media attachment inside a message bubble.
 *
 * The backend only returns a `media` field once it persists media and exposes
 * it as a URL (the Supabase public URL in production, or GET /api/media/:id for
 * the on-disk store); older servers omit it, so this component is only reached
 * for messages that actually carry media. A failed load (missing file, dead
 * URL) falls back to an attachment chip so the bubble is never empty.
 *
 * Bytes are only requested once the attachment scrolls near the viewport: the
 * browser never sees a `src` for off-screen messages, so opening a media-heavy
 * thread costs nothing until you actually reach the media. Video/audio add a
 * second layer with `preload="none"`, so even a visible player fetches only
 * when played.
 *
 * @param {object} props
 * @param {import("@/lib/api").MessageMedia} props.media
 */
export default function MediaContent({ media }) {
  const [failed, setFailed] = useState(false);
  const [ref, inView] = useInView({ rootMargin: "200px" });
  const src = mediaUrl(media?.url);

  if (!media || !src || failed) {
    return <AttachmentChip media={media} />;
  }

  if (media.type === "sticker") {
    return inView ? (
      <img
        src={src}
        alt={media.fileName || "Sticker"}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-32 object-contain"
      />
    ) : (
      <span ref={ref} aria-hidden className="block size-32 rounded-lg bg-muted" />
    );
  }

  if (media.type === "image") {
    return inView ? (
      <img
        src={src}
        alt={media.fileName || "Image"}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg object-contain"
      />
    ) : (
      <span
        ref={ref}
        aria-hidden
        className="block h-48 w-64 max-w-full animate-pulse rounded-lg bg-muted"
      />
    );
  }

  if (media.type === "video") {
    return inView ? (
      <video
        src={src}
        controls
        preload="none"
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg bg-black/20"
      />
    ) : (
      <span
        ref={ref}
        aria-hidden
        className="flex h-48 w-64 max-w-full items-center justify-center rounded-lg bg-black/20 text-muted-foreground"
      >
        <Play className="size-8" />
      </span>
    );
  }

  if (media.type === "audio") {
    return (
      <audio
        src={src}
        controls
        preload="none"
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
