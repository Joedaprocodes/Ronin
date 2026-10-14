import { Fragment, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpIcon,
  Check,
  CornerUpLeft,
  Copy,
  EllipsisVertical,
  Eye,
  EyeOff,
  Flag,
  Info,
  Loader2,
  MessageSquare,
  PaperclipIcon,
  Pencil,
  Plus,
  RefreshCw,
  SmilePlus,
  Sticker as StickerIcon,
  Trash2,
  Users,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { senderColor } from "@/lib/senderColor";
import { deleteMessage, editMessage, sendMessage, sendReaction } from "@/lib/api";
import {
  MAX_MEDIA_BYTES,
  fileToBase64,
  formatBytes,
  getMediaType,
  mediaEmoji,
  mediaLabel,
} from "@/lib/media";
import { useInboxData } from "@/context/InboxDataContext";
import { useThread } from "@/hooks/useThread";
import { useOnline } from "@/hooks/useOnline";
import MediaContent from "@/components/MediaContent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import ScreenHeader from "@/components/ScreenHeader";

/* -------------------------------------------------------------------------- */
/*  Types (JSDoc)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} ConversationMessage
 * @property {string} id
 * @property {"me" | "them"} from
 * @property {string} [sender]
 * @property {string} text
 * @property {string} time
 * @property {import("@/lib/api").MessageMedia} [media]
 * @property {import("@/lib/api").QuotedMessage} [quoted]
 * @property {boolean} [deleted] - the message was deleted (tombstone)
 * @property {boolean} [edited] - the message's text was edited
 * @property {import("@/lib/api").MessageReaction[]} [reactions] - reactions on the message
 * @property {import("@/lib/api").SystemEvent} [system] - a group membership notice
 */

/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} jid
 * @property {string} name
 * @property {boolean} isGroup
 * @property {number} unread
 * @property {boolean} flagged
 * @property {string} time
 * @property {string} lastMessageAt
 * @property {ConversationMessage[]} messages
 */

/**
 * A file staged in the composer, ready to be sent.
 * @typedef {Object} PendingAttachment
 * @property {string} name
 * @property {number} size
 * @property {"image" | "video" | "audio" | "document"} type
 * @property {import("@/lib/api").SendMedia} media
 */

function initials(name) {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/* -------------------------------------------------------------------------- */
/*  Timestamps                                                                */
/* -------------------------------------------------------------------------- */

// Created once: locale + 12h/24h are resolved by Intl, not hand-rolled.
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const FULL_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const DAY_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

// A silence longer than this starts a new "run" (so the next bubble gets its
// own timestamp instead of being grouped with an earlier message).
const RUN_GAP_MS = 10 * 60 * 1000;

/** Local calendar day key, so a run never spans midnight. "" when unparseable. */
function dayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Whether two adjacent messages belong to the same run — same sender, same
 * local day, and less than RUN_GAP_MS apart. The list is ascending by time, so
 * the gap is the newer minus the older. Membership notices always break a run.
 */
function sameRun(a, b) {
  if (!a || !b) return false;
  if (a.system || b.system) return false;
  if (a.from !== b.from || a.sender !== b.sender) return false;

  const ta = new Date(a.time).getTime();
  const tb = new Date(b.time).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;

  if (dayKey(a.time) !== dayKey(b.time)) return false;
  return tb - ta <= RUN_GAP_MS;
}

/** Short clock label for a bubble ("2:32 PM" / "14:32"); "" if unparseable. */
function clock(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : TIME_FMT.format(date);
}

/** Full date + time for the tooltip; undefined if unparseable. */
function fullStamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : FULL_FMT.format(date);
}

/** "Today" / "Yesterday" / "October 14, 2026" for a day separator. "" if bad. */
function dateLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return DAY_FMT.format(date);
}

/* -------------------------------------------------------------------------- */
/*  Reactions                                                                 */
/* -------------------------------------------------------------------------- */

// The quick set offered in the hover picker (WhatsApp's own default row).
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// How many distinct emojis an aggregate badge shows before collapsing the rest.
const MAX_REACTION_CHIPS = 3;

/**
 * Groups a message's reactions by emoji for display:
 * `[{ text, count, mine, names }]`. `names` powers the "who reacted" tooltip.
 *
 * @param {import("@/lib/api").MessageReaction[]} [reactions]
 */
function reactionSummary(reactions) {
  const groups = new Map();
  for (const r of reactions ?? []) {
    if (!r?.text) continue;
    const group = groups.get(r.text) ?? {
      text: r.text,
      count: 0,
      mine: false,
      names: [],
    };
    group.count += 1;
    if (r.from === "me") {
      group.mine = true;
      group.names.push("You");
    } else {
      group.names.push(r.sender || "Someone");
    }
    groups.set(r.text, group);
  }
  return [...groups.values()];
}

/** One-line preview of a message, used by the reply banner above the composer. */
function messageSnippet(message) {
  if (message.media) {
    return `${mediaEmoji(message.media.type)} ${mediaLabel(message.media.type)}${
      message.text ? ` · ${message.text}` : ""
    }`;
  }
  return message.text ?? "";
}

/* -------------------------------------------------------------------------- */
/*  Edit / delete                                                             */
/* -------------------------------------------------------------------------- */

// WhatsApp only lets you edit your own text messages, and only for a short
// while after sending. The window is enforced here (client-side) so the option
// disappears once it lapses; the server rejects edits it doesn't allow anyway.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Whether a message can still be edited: ours, text-only, inside the window. */
function canEditMessage(m) {
  if (!m || m.from !== "me" || m.deleted || m.media || !m.text) return false;
  const t = new Date(m.time).getTime();
  return Number.isFinite(t) && Date.now() - t <= EDIT_WINDOW_MS;
}

/** Whether a deleted message kept content we can let an admin reveal. */
function hasHiddenContent(m) {
  return Boolean(m?.text || m?.media || m?.quoted);
}

/* -------------------------------------------------------------------------- */
/*  Quoted messages                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The "replying to…" block shown above a message's own content.
 *
 * Rendered inside MessageScrollerProvider (the message list), so it can use
 * useMessageScroller() to jump to the quoted message when it's still loaded.
 * Media quotes show an icon + label (the bytes are never fetched).
 *
 * @param {{ quoted: import("@/lib/api").QuotedMessage, own: boolean }} props
 */
function QuotedMessage({ quoted, own }) {
  const { scrollToMessage } = useMessageScroller();

  const preview = quoted.media
    ? `${mediaEmoji(quoted.media.type)} ${mediaLabel(quoted.media.type)}${
        quoted.text ? ` · ${quoted.text}` : ""
      }`
    : quoted.text;

  const className = cn(
    "mb-1 block w-full overflow-hidden rounded-md border-l-2 px-2 py-1 text-xs wrap-anywhere",
    own
      ? "border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/90"
      : "border-emerald-500/70 bg-background/70 text-muted-foreground"
  );

  const body = (
    <>
      {quoted.sender ? (
        <span
          className={cn(
            "block text-[11px] font-medium",
            own ? "text-primary-foreground" : senderColor(quoted.sender)
          )}
        >
          {quoted.sender}
        </span>
      ) : null}
      <span className="line-clamp-2">{preview}</span>
    </>
  );

  if (!quoted.id) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      aria-label="Jump to quoted message"
      title="Jump to quoted message"
      onClick={() =>
        scrollToMessage(quoted.id, { align: "center", behavior: "smooth" })
      }
      className={cn(className, "cursor-pointer text-left")}
    >
      {body}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Message actions (edit / delete)                                           */
/* -------------------------------------------------------------------------- */

/**
 * The "…" menu beside a message bubble. Rendered next to (not inside) the
 * bubble; it fades in on hover / keyboard focus and stays visible on touch.
 * Every non-deleted message gets Reply (plus Copy when it has text); Edit and
 * Delete only appear on our own messages.
 *
 * @param {{
 *   mine: boolean,
 *   canEdit: boolean,
 *   canCopy: boolean,
 *   onReply: () => void,
 *   onCopy: () => void,
 *   onEdit: () => void,
 *   onDelete: () => void,
 * }} props
 */
function MessageActions({
  mine,
  canEdit,
  canCopy,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Message actions"
            className="size-6 rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur hover:text-foreground"
          />
        }
      >
        <EllipsisVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-36">
        <DropdownMenuItem onClick={onReply}>
          <CornerUpLeft className="size-4" />
          Reply
        </DropdownMenuItem>
        {canCopy ? (
          <DropdownMenuItem onClick={onCopy}>
            <Copy className="size-4" />
            Copy
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {mine ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Reactions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The emoji picker shown beside a message's bubble. A popover (rather than a
 * menu, so a text input can live inside it) offers the quick set plus a "+"
 * button that reveals an input for any other emoji.
 *
 * @param {{ onPick: (emoji: string) => void }} props
 */
function ReactionPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");

  function reset() {
    setCustom(false);
    setCustomText("");
  }

  function pick(emoji) {
    const text = emoji.trim();
    if (!text) return;
    onPick(text);
    reset();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="React to message"
            title="React"
            className="size-6 rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur hover:text-foreground"
          />
        }
      >
        <SmilePlus className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-auto">
        <div className="flex items-center gap-0.5">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => pick(emoji)}
              aria-label={`React with ${emoji}`}
              className="flex size-8 items-center justify-center rounded-full text-base transition-colors hover:bg-accent"
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustom((value) => !value)}
            aria-label="Use another emoji"
            title="Use another emoji"
            aria-expanded={custom}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        {custom ? (
          <form
            className="mt-1 flex items-center gap-1 border-t pt-1"
            onSubmit={(event) => {
              event.preventDefault();
              pick(customText);
            }}
          >
            <input
              autoFocus
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              placeholder="Any emoji…"
              maxLength={32}
              aria-label="Custom reaction"
              className="h-7 w-36 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="icon-xs" disabled={!customText.trim()}>
              <ArrowUpIcon className="size-4" />
              <span className="sr-only">React</span>
            </Button>
          </form>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The aggregate reaction pill under a bubble: up to three emojis with counts.
 * Tapping an emoji toggles it (adding it, or removing it when it is ours).
 *
 * @param {{
 *   reactions: import("@/lib/api").MessageReaction[],
 *   onToggle: (emoji: string) => void,
 * }} props
 */
function ReactionBadge({ reactions, onToggle }) {
  const groups = reactionSummary(reactions);
  if (!groups.length) return null;
  const shown = groups.slice(0, MAX_REACTION_CHIPS);
  const extra = groups.length - shown.length;

  return (
    <div className="relative z-10 -mt-2 flex items-center gap-0.5 rounded-full bg-background px-1 py-0.5 shadow-sm ring-1 ring-foreground/10">
      {shown.map((group) => (
        <button
          key={group.text}
          type="button"
          onClick={() => onToggle(group.text)}
          title={group.names.join(", ")}
          aria-label={`${group.text} ${group.count} — ${
            group.mine ? "remove your reaction" : "react too"
          }`}
          className={cn(
            "flex items-center gap-0.5 rounded-full px-1 text-xs leading-none transition-colors",
            group.mine ? "bg-primary/10" : "hover:bg-accent"
          )}
        >
          <span aria-hidden>{group.text}</span>
          {group.count > 1 ? (
            <span className="text-[10px] text-muted-foreground">
              {group.count}
            </span>
          ) : null}
        </button>
      ))}
      {extra > 0 ? (
        <span className="px-1 text-[10px] text-muted-foreground">+{extra}</span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function ConversationScreen() {
  const { jid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { conversations, markRead, setFlagged: setInboxFlagged } = useInboxData();
  const online = useOnline();

  const {
    conversation,
    messages,
    loading,
    error,
    hasMore,
    loadingMore,
    loadOlder,
    refresh,
    appendOptimistic,
    setConversationFlagged,
  } = useThread(jid);

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  // Edit/delete: the message a dialog is acting on, plus per-message reveal of
  // the original content behind a delete tombstone.
  const [editTarget, setEditTarget] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [revealedIds, setRevealedIds] = useState(() => new Set());
  // Reply (quoted send). Stored with the thread it belongs to so switching
  // threads (or the message being deleted) simply drops it — no effect needed.
  // The cold `copiedId` powers the brief "Copied" confirmation.
  const [reply, setReply] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const fileInputRef = useRef(null);
  const stickerInputRef = useRef(null);
  const topRef = useRef(null);
  const copyTimer = useRef(null);

  const replyTarget = reply?.jid === jid ? reply.message : null;
  const replyDeleted = Boolean(
    replyTarget && messages.some((m) => m.id === replyTarget.id && m.deleted)
  );
  const activeReply = replyDeleted ? null : replyTarget;

  // Whether the tab is focused. Incoming messages are only auto-marked read
  // while the user is actually looking at the thread — one that lands in a
  // background tab stays unread until they come back to it.
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible"
  );
  useEffect(() => {
    const onVisibility = () =>
      setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Opening the thread clears its unread badge app-wide (id === jid).
  useEffect(() => {
    if (jid) markRead(jid);
  }, [jid, markRead]);

  // Messages arriving while the thread is open come in over SSE (see useThread)
  // but don't mark the chat read on their own. Whenever the shared list reports
  // unread for this chat while it's on screen, clear it again: this catches new
  // messages *and* the debounced inbox refresh racing the open-time markRead.
  const conversationUnread = conversations.find((c) => c.id === jid)?.unread ?? 0;
  useEffect(() => {
    if (jid && visible && conversationUnread > 0) markRead(jid);
  }, [jid, visible, conversationUnread, markRead]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // When scrolled to the top of the list, fetch the previous page. The scroller
  // keeps the scroll position, so prepended messages appear above what's shown.
  useEffect(() => {
    const node = topRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder();
      },
      { rootMargin: "300px 0px 0px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadOlder]);

  function clearAttachment() {
    setAttachment(null);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openStickerPicker() {
    stickerInputRef.current?.click();
  }

  /**
   * @param {File} file
   * @param {import("@/lib/media").MediaType} [forcedType] - send as this bucket
   *   regardless of the file's MIME type (used by the sticker picker).
   */
  function handleFilePick(file, forcedType) {
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) {
      setSendError("File is too large (max 20 MB)");
      return;
    }

    fileToBase64(file)
      .then(({ data, mimeType }) => {
        const type = forcedType ?? getMediaType(file.type);
        /** @type {import("@/lib/api").SendMedia} */
        const media = {
          type,
          data,
          mimeType: mimeType || file.type,
        };
        // Documents must carry a filename for the backend to label them;
        // stickers are sent as bare images, so they don't.
        if (type === "document") media.fileName = file.name;

        setAttachment({
          name: file.name,
          size: file.size,
          type,
          media,
        });
        setSendError("");
      })
      .catch(() => {
        setSendError("Failed to read file");
      });
  }

  async function handleSend() {
    if (sending) return;
    if (!online) {
      setSendError("You're offline — sending needs a connection");
      return;
    }
    const text = draft.trim();
    if (!text && !attachment) return;
    setSending(true);
    setSendError("");

    const payload = {};
    if (text) payload.text = text;
    if (activeReply) payload.quotedId = activeReply.id;
    if (attachment?.media) {
      // The draft doubles as the caption at send time, so a caption typed
      // after the file was picked is included.
      const media = { ...attachment.media };
      // Documents and stickers carry no caption; image/video fold the draft in.
      if (media.type !== "document" && media.type !== "sticker" && text) {
        media.caption = text;
      }
      payload.media = media;
    }

    try {
      const result = await sendMessage(jid, payload);
      if (result.ok) {
        setDraft("");
        clearAttachment();
        setReply(null);
        // Newer backends echo the persisted row; show it immediately so the
        // message is visible even if the follow-up refetch hasn't landed yet.
        if (result.message) appendOptimistic(result.message);
        await refresh();
      } else {
        // Keep the draft + attachment so the user can retry.
        setSendError(result.error || "Failed to send message");
      }
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Escape" && activeReply) {
      event.preventDefault();
      setReply(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function toggleFlag() {
    if (!conversation) return;
    const id = conversation.id ?? conversation.jid ?? jid;
    const nextFlagged = !conversation.flagged;

    // Update the thread header and the shared inbox list in one go
    // (the latter also persists to the backend and the offline cache).
    setConversationFlagged(nextFlagged);
    setInboxFlagged(id, nextFlagged);
  }

  function toggleReveal(id) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openReply(message) {
    setSendError("");
    setReply({ jid, message });
  }

  /**
   * Copies a message's text to the clipboard, falling back to a throwaway
   * textarea when the async Clipboard API is unavailable (insecure context).
   *
   * @param {ConversationMessage} message
   */
  async function copyText(message) {
    const text = message.text ?? "";
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopiedId(message.id);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setSendError("Couldn't copy — the clipboard is blocked");
    }
  }

  function openEdit(message) {
    setActionError("");
    setEditTarget(message);
    setEditDraft(message.text ?? "");
  }

  function closeEdit() {
    if (actionBusy) return;
    setEditTarget(null);
    setEditDraft("");
    setActionError("");
  }

  function openDelete(message) {
    setActionError("");
    setDeleteTarget(message);
  }

  function closeDelete() {
    if (actionBusy) return;
    setDeleteTarget(null);
    setActionError("");
  }

  async function confirmEdit(event) {
    event?.preventDefault();
    if (actionBusy || !editTarget) return;
    const text = editDraft.trim();
    if (!text) {
      setActionError("A message can't be empty");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      const result = await editMessage(jid, editTarget.id, text);
      if (result.ok) {
        // The backend echoes the refreshed row; swap the bubble in place.
        if (result.message) appendOptimistic(result.message);
        setEditTarget(null);
        setEditDraft("");
      } else {
        setActionError(result.error || "Failed to edit message");
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmDelete(event) {
    event?.preventDefault();
    if (actionBusy || !deleteTarget) return;
    setActionBusy(true);
    setActionError("");
    try {
      const result = await deleteMessage(jid, deleteTarget.id);
      if (result.ok) {
        if (result.message) appendOptimistic(result.message);
        setDeleteTarget(null);
      } else {
        setActionError(result.error || "Failed to delete message");
      }
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * Adds or clears our reaction on a message. Tapping the emoji we already used
   * removes it; anything else sets it. Works on any non-deleted message and the
   * backend echoes the refreshed row so the badge updates in place.
   *
   * @param {ConversationMessage} message
   * @param {string} emoji
   */
  async function toggleReaction(message, emoji) {
    if (!online) {
      setSendError("You're offline — reacting needs a connection");
      return;
    }
    const mine = (message.reactions ?? []).find((r) => r.from === "me");
    const text = mine?.text === emoji ? "" : emoji;
    const result = await sendReaction(jid, message.id, text);
    if (result.ok) {
      if (result.message) appendOptimistic(result.message);
      setSendError("");
    } else {
      setSendError(result.error || "Failed to react");
    }
  }

  // A brand-new chat (started from a saved contact) has no history yet, so the
  // backend's stub name is just the number — prefer the name passed through the
  // router state, and fall back to the conversation's own name once it has one.
  const stateName = location.state?.name;
  const name = conversation?.messages?.length
    ? conversation.name
    : stateName || conversation?.name || (loading ? "Conversation" : "Unknown");
  const isGroup = Boolean(conversation?.isGroup);
  const subtitle = loading
    ? "Loading…"
    : conversation
      ? isGroup
        ? "Group"
        : "Direct message"
      : "";

  // Offline with cached messages: the thread is readable, but it may be stale,
  // so say so. The banner sits above the fixed-height scroller, which has to
  // give up the same amount of room to keep the composer above the fold.
  const showOfflineNote = !online && messages.length > 0;

  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <ScreenHeader
        back="/inbox"
        avatar={
          <Avatar className="size-9">
            <AvatarFallback>
              {isGroup ? <Users className="size-5" /> : initials(name)}
            </AvatarFallback>
          </Avatar>
        }
        title={name}
        subtitle={subtitle}
        action={
          conversation ? (
            <div className="flex items-center gap-1">
              {isGroup ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Group info"
                  onClick={() =>
                    navigate(
                      `/groups/${encodeURIComponent(conversation.jid ?? jid)}`
                    )
                  }
                >
                  <Info className="size-4" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label={conversation.flagged ? "Remove flag" : "Flag conversation"}
                onClick={toggleFlag}
              >
                <Flag
                  className={cn(
                    "size-4",
                    conversation.flagged && "fill-current text-destructive"
                  )}
                />
              </Button>
            </div>
          ) : null
        }
      />

      {showOfflineNote ? (
        <p className="mt-4 rounded-lg border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
          Offline — showing the messages saved on this device.
        </p>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading conversation…
        </div>
      ) : error && messages.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <MessageSquare className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {online ? "Couldn't load conversation" : "You're offline"}
            </p>
            <p className="text-sm text-muted-foreground">
              {online
                ? "The server didn't respond — check your connection, then try again."
                : "This chat hasn't been saved to this device yet. Reconnect to load it."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            {online ? <RefreshCw className="size-4" /> : null}
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Thread */}
          <div
            className={cn(
              "mt-4 overflow-hidden bg-transparent",
              showOfflineNote
                ? "h-[calc(100svh-9.75rem)]"
                : "h-[calc(100svh-6.5rem)]"
            )}
          >
            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-2 p-0 pb-24">
                    {hasMore ? (
                      <MessageScrollerItem>
                        <div
                          ref={topRef}
                          className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
                        >
                          {loadingMore ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" />
                              Loading earlier messages…
                            </>
                          ) : (
                            "Load earlier messages"
                          )}
                        </div>
                      </MessageScrollerItem>
                    ) : null}

                    {messages.length === 0 ? (
                      <MessageScrollerItem>
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No messages yet.
                        </p>
                      </MessageScrollerItem>
                    ) : (
                      messages.map((m, i) => {
                        // A day separator heads the first message of each local day.
                        const day = dayKey(m.time);
                        const showDay =
                          Boolean(day) && day !== dayKey(messages[i - 1]?.time);
                        // Only the last bubble of a run carries a timestamp.
                        const stamp = sameRun(m, messages[i + 1])
                          ? ""
                          : clock(m.time);

                        const separator = showDay ? (
                          <MessageScrollerItem>
                            <div className="flex w-full items-center justify-center py-1">
                              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {dateLabel(m.time)}
                              </span>
                            </div>
                          </MessageScrollerItem>
                        ) : null;

                        // Membership notices are centered, chrome-less lines: no
                        // bubble, no sender label and no hover actions.
                        if (m.system) {
                          return (
                            <Fragment key={m.id}>
                              {separator}
                              <MessageScrollerItem messageId={m.id}>
                                <p
                                  title={fullStamp(m.time)}
                                  className="w-full py-1 text-center text-xs text-muted-foreground"
                                >
                                  {m.text}
                                </p>
                              </MessageScrollerItem>
                            </Fragment>
                          );
                        }

                        // Only the first incoming bubble of a group run carries
                        // the sender's name (or their id when no name is known).
                        const sender = m.sender?.trim();
                        const showSender =
                          isGroup &&
                          m.from === "them" &&
                          sender &&
                          !sameRun(messages[i - 1], m);
                        // Stickers (and only stickers) render without a bubble.
                        const isSticker =
                          m.media?.type === "sticker" && !m.text && !m.quoted;
                        // The "…" menu is offered on every non-deleted message
                        // (Reply/Copy); Edit and Delete stay ours-only.
                        const editable = canEditMessage(m);
                        const revealed = revealedIds.has(m.id);
                        const mine = m.from === "me";
                        // A message the backend couldn't turn into text, media or a
                        // quote (an unsupported WhatsApp type). Render a placeholder
                        // instead of an empty bubble, echoing the deleted tombstone.
                        const uncaught = !m.text && !m.media && !m.quoted;

                        return (
                          <Fragment key={m.id}>
                            {separator}
                            <MessageScrollerItem
                              messageId={m.id}
                              scrollAnchor={mine}
                            >
                              <div
                                className={cn(
                                  "flex flex-col",
                                  mine ? "items-end" : "items-start"
                                )}
                              >
                                <div
                                  className={cn(
                                    "group/msg relative max-w-[80%] text-sm wrap-anywhere",
                                    // A bare sticker has no bubble — it floats on the
                                    // chat background, like WhatsApp.
                                    isSticker
                                      ? "bg-transparent p-0"
                                      : cn(
                                          "rounded-2xl px-3 py-2",
                                          m.from === "me"
                                            ? "rounded-br-sm bg-primary text-primary-foreground"
                                            : "rounded-bl-sm bg-muted"
                                        )
                                  )}
                                >
                                  {showSender ? (
                                    <span
                                      className={cn(
                                        "mb-0.5 block text-[11px] font-medium",
                                        senderColor(sender)
                                      )}
                                    >
                                      {sender}
                                    </span>
                                  ) : null}

                                  {m.deleted ? (
                                    // Tombstone: WhatsApp's own copy, plus a low-key
                                    // toggle that reveals the original content the
                                    // store still holds for admins.
                                    <>
                                      <span className="flex items-center gap-1.5 italic opacity-80">
                                        <Trash2 className="size-3.5 shrink-0" />
                                        {m.from === "me"
                                          ? "You deleted this message"
                                          : "This message was deleted"}
                                        {hasHiddenContent(m) ? (
                                          <button
                                            type="button"
                                            onClick={() => toggleReveal(m.id)}
                                            aria-label={
                                              revealed
                                                ? "Hide deleted content"
                                                : "Reveal deleted content"
                                            }
                                            title={
                                              revealed
                                                ? "Hide deleted content"
                                                : "Reveal deleted content"
                                            }
                                            className="ml-0.5 inline-flex items-center opacity-50 transition-opacity hover:opacity-100"
                                          >
                                            {revealed ? (
                                              <EyeOff className="size-3.5" />
                                            ) : (
                                              <Eye className="size-3.5" />
                                            )}
                                          </button>
                                        ) : null}
                                      </span>
                                      {revealed && hasHiddenContent(m) ? (
                                        <div className="mt-1.5 border-t border-current/20 pt-1.5 opacity-90">
                                          {m.quoted ? (
                                            <QuotedMessage
                                              quoted={m.quoted}
                                              own={m.from === "me"}
                                            />
                                          ) : null}
                                          {m.media ? (
                                            <MediaContent media={m.media} />
                                          ) : null}
                                          {m.text ? (
                                            <p
                                              className={cn(
                                                "whitespace-pre-wrap",
                                                m.media && "mt-1"
                                              )}
                                            >
                                              {m.text}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <>
                                      {m.quoted ? (
                                        <QuotedMessage
                                          quoted={m.quoted}
                                          own={m.from === "me"}
                                        />
                                      ) : null}
                                      {m.media ? (
                                        <MediaContent media={m.media} />
                                      ) : null}
                                      {m.text ? (
                                        <p
                                          className={cn(
                                            "whitespace-pre-wrap",
                                            m.media && "mt-1"
                                          )}
                                        >
                                          {m.text}
                                          {m.edited ? (
                                            <span className="ml-1.5 align-baseline text-[10px] opacity-70">
                                              (edited)
                                            </span>
                                          ) : null}
                                        </p>
                                      ) : null}
                                      {uncaught ? (
                                        <span className="flex items-center gap-1.5 italic opacity-80">
                                          <MessageSquare className="size-3.5 shrink-0" />
                                          Uncaught message
                                        </span>
                                      ) : null}
                                    </>
                                  )}

                                  {!m.deleted ? (
                                    <div
                                      className={cn(
                                        "absolute top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 max-sm:opacity-100",
                                        mine
                                          ? "right-full pr-1"
                                          : "left-full pl-1"
                                      )}
                                    >
                                      <div className="flex items-center gap-1">
                                        <ReactionPicker
                                          onPick={(emoji) =>
                                            toggleReaction(m, emoji)
                                          }
                                        />
                                        <MessageActions
                                          mine={mine}
                                          canEdit={editable}
                                          canCopy={Boolean(m.text)}
                                          onReply={() => openReply(m)}
                                          onCopy={() => copyText(m)}
                                          onEdit={() => openEdit(m)}
                                          onDelete={() => openDelete(m)}
                                        />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>

                                <ReactionBadge
                                  reactions={m.reactions}
                                  onToggle={(emoji) => toggleReaction(m, emoji)}
                                />

                                {stamp ? (
                                  <time
                                    dateTime={m.time}
                                    title={fullStamp(m.time)}
                                    className="mt-0.5 px-1 text-[11px] text-muted-foreground"
                                  >
                                    {stamp}
                                  </time>
                                ) : null}
                              </div>
                            </MessageScrollerItem>
                          </Fragment>
                        );
                      })
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="data-[direction=end]:bottom-24" />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>

          {/* Composer — floats at the bottom of the screen, mirroring the main nav */}
          <div className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto w-full max-w-2xl px-4">
            {sendError || !online ? (
              <p
                role="alert"
                className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {!online
                  ? "You're offline — sending needs a connection"
                  : sendError}
              </p>
            ) : null}

            {copiedId ? (
              <p
                role="status"
                className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Check className="size-3.5" />
                Copied to clipboard
              </p>
            ) : null}

            {activeReply ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg shadow-black/5">
                <CornerUpLeft
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-primary">
                    {activeReply.from === "me"
                      ? "You"
                      : isGroup
                        ? activeReply.sender ?? "Them"
                        : name}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {messageSnippet(activeReply)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Cancel reply"
                  onClick={() => setReply(null)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            ) : null}

            {attachment ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg shadow-black/5">
                <span aria-hidden className="text-base leading-none">
                  {mediaEmoji(attachment.type)}
                </span>
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove attachment"
                  onClick={clearAttachment}
                  disabled={sending}
                >
                  <XIcon />
                </Button>
              </div>
            ) : null}

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

            <input
              ref={stickerInputRef}
              type="file"
              accept="image/webp,image/png,image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFilePick(file, "sticker");
                event.target.value = "";
              }}
            />

            <form
              className="w-full"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <InputGroup className="bg-background shadow-lg shadow-black/5">
                <InputGroupAddon align="inline-start" className="gap-1 pl-2">
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Add photos & files"
                    onClick={openFilePicker}
                    disabled={sending || !online}
                  >
                    <PaperclipIcon />
                  </InputGroupButton>
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Send a sticker"
                    onClick={openStickerPicker}
                    disabled={sending || !online}
                  >
                    <StickerIcon />
                  </InputGroupButton>
                </InputGroupAddon>

                <InputGroupTextarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Message"
                  rows={1}
                  className="max-h-40 min-h-14 px-1 py-2.5"
                  disabled={sending || !online}
                />

                <InputGroupAddon align="inline-end" className="pr-2">
                  <InputGroupButton
                    type="submit"
                    variant="default"
                    size="icon-sm"
                    disabled={
                      sending ||
                      !online ||
                      (!draft.trim() && !attachment)
                    }
                  >
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUpIcon />
                    )}
                    <span className="sr-only">Send</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </form>
          </div>
        </>
      )}

      {/* Edit — text-only and bounded to a short window after sending. */}
      <AlertDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) closeEdit();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit message</AlertDialogTitle>
            <AlertDialogDescription>
              WhatsApp only allows editing your own messages, shortly after they
              were sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                confirmEdit();
              }
            }}
            rows={3}
            maxLength={4096}
            aria-label="Message text"
            autoFocus
          />
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmEdit();
              }}
              disabled={actionBusy || !editDraft.trim()}
            >
              {actionBusy ? "Saving…" : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete — revokes for everyone; the original stays revealable here. */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;ll be removed for everyone in the chat and replaced with a
              tombstone. You can still reveal the original here afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={actionBusy}
            >
              {actionBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}