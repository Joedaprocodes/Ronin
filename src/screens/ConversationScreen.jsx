import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpIcon,
  Flag,
  Info,
  Loader2,
  MessageSquare,
  PaperclipIcon,
  Users,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage } from "@/lib/api";
import {
  MAX_MEDIA_BYTES,
  fileToBase64,
  formatBytes,
  getMediaType,
  mediaEmoji,
} from "@/lib/media";
import { useInboxData } from "@/context/InboxDataContext";
import { useThread } from "@/hooks/useThread";
import { useOnline } from "@/hooks/useOnline";
import MediaContent from "@/components/MediaContent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
 * the gap is the newer minus the older.
 */
function sameRun(a, b) {
  if (!a || !b) return false;
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

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function ConversationScreen() {
  const { jid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { markRead, setFlagged: setInboxFlagged } = useInboxData();
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
  const fileInputRef = useRef(null);
  const topRef = useRef(null);

  // Opening the thread clears its unread badge app-wide (id === jid).
  useEffect(() => {
    if (jid) markRead(jid);
  }, [jid, markRead]);

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

  function handleFilePick(file) {
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) {
      setSendError("File is too large (max 20 MB)");
      return;
    }

    fileToBase64(file)
      .then(({ data, mimeType }) => {
        const type = getMediaType(file.type);
        /** @type {import("@/lib/api").SendMedia} */
        const media = {
          type,
          data,
          mimeType: mimeType || file.type,
        };
        // Documents must carry a filename for the backend to label them.
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
    if (attachment?.media) {
      // The draft doubles as the caption at send time, so a caption typed
      // after the file was picked is included.
      const media = { ...attachment.media };
      if (media.type !== "document" && text) media.caption = text;
      payload.media = media;
    }

    try {
      const result = await sendMessage(jid, payload);
      if (result.ok) {
        setDraft("");
        clearAttachment();
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

      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading conversation…
        </div>
      ) : error && messages.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <MessageSquare className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Couldn't load conversation</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      ) : (
        <>
          {/* Thread */}
          <div className="mt-4 h-[calc(100svh-6.5rem)] overflow-hidden bg-transparent">
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
                        // Only the last bubble of a run carries a timestamp.
                        const stamp = sameRun(m, messages[i + 1])
                          ? ""
                          : clock(m.time);
                        // Only the first incoming bubble of a group run carries
                        // the sender's name (or their id when no name is known).
                        const sender = m.sender?.trim();
                        const showSender =
                          isGroup &&
                          m.from === "them" &&
                          sender &&
                          !sameRun(messages[i - 1], m);

                        return (
                          <MessageScrollerItem
                            key={m.id}
                            messageId={m.id}
                            scrollAnchor={m.from === "me"}
                          >
                            <div
                              className={cn(
                                "flex flex-col",
                                m.from === "me" ? "items-end" : "items-start"
                              )}
                            >
                              <div
                                className={cn(
                                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm wrap-anywhere",
                                  m.from === "me"
                                    ? "rounded-br-sm bg-primary text-primary-foreground"
                                    : "rounded-bl-sm bg-muted"
                                )}
                              >
                                {showSender ? (
                                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground">
                                    {sender}
                                  </span>
                                ) : null}
                                {m.media ? <MediaContent media={m.media} /> : null}
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

            <form
              className="w-full"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <InputGroup className="bg-background shadow-lg shadow-black/5">
                <InputGroupAddon align="inline-start" className="pl-2">
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
    </div>
  );
}