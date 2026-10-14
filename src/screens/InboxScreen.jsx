import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, Inbox, Loader2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { senderColor } from "@/lib/senderColor";
import { mediaEmoji, mediaLabel } from "@/lib/media";
import { listConversations } from "@/lib/api";
import { useConversations } from "@/hooks/useConversations";
import { useInboxPreferences } from "@/context/InboxPreferencesContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** Preview text for the last message, including a media glyph when present. */
function lastMessageText(message) {
  // A deleted message must never leak its (still-stored) original content into
  // the list — show the WhatsApp tombstone instead.
  if (message.deleted) return "This message was deleted";
  const glyph = message.media ? `${mediaEmoji(message.media.type)} ` : "";
  const body = message.text || (message.media ? mediaLabel(message.media.type) : "");
  const preview = `${glyph}${body}`.trim();
  // Mirror the conversation bubble: an unsupported message with no text, media
  // or quote would otherwise preview as an empty string.
  if (!preview && !message.quoted) return "Uncaught message";
  return preview;
}

function previewOf(conversation) {
  const messages = conversation.messages ?? [];
  const last = messages[messages.length - 1] ?? conversation.lastMessage;
  if (!last) return "";
  // Group membership notices read verbatim ("Alice added Bob") — no sender
  // prefix, since the sentence already names everyone involved.
  if (last.system) return last.text;
  if (last.deleted) {
    return last.from === "me"
      ? "You deleted this message"
      : "This message was deleted";
  }
  const content = lastMessageText(last);
  if (last.from === "me") return `You: ${content}`;
  if (conversation.isGroup && last.sender) {
    // Color the sender's name the same way the conversation does.
    return (
      <>
        <span className={cn("font-medium", senderColor(last.sender))}>
          {last.sender}
        </span>
        {`: ${content}`}
      </>
    );
  }
  return content;
}

/** Copy for the empty list, tailored to the error / search / active tab. */
function emptyStateCopy(error, isSearching, filter) {
  if (error && !isSearching) {
    return { title: "Couldn't load conversations", detail: error.message };
  }
  if (isSearching) {
    return { title: "No conversations found", detail: "Try a different search." };
  }
  if (filter === "unread") {
    return { title: "You're all caught up", detail: "No unread conversations." };
  }
  if (filter === "flagged") {
    return {
      title: "No flagged conversations",
      detail: "Flag a conversation to find it here.",
    };
  }
  return {
    title: "No conversations found",
    detail: "Try a different search or filter.",
  };
}

/* -------------------------------------------------------------------------- */
/*  Screen                                                                    */
/* -------------------------------------------------------------------------- */

export default function InboxScreen() {
  const navigate = useNavigate();
  const { conversations, loading, error, markRead, setFlagged } =
    useConversations();
  const { defaultTab } = useInboxPreferences();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(defaultTab); // "all" | "unread" | "flagged"
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const searchIdRef = useRef(0);

  const isSearching = query.trim().length > 0;
  const emptyCopy = emptyStateCopy(error, isSearching, filter);

  const counts = useMemo(
    () => ({
      all: conversations.length,
      unread: conversations.filter((c) => c.unread > 0).length,
      flagged: conversations.filter((c) => c.flagged).length,
    }),
    [conversations]
  );

  // Server-side search (GET /api/inbox?q=): debounced, stale-proof. Only the
  // latest request may commit; failures keep the previous results and surface
  // a quiet inline note instead of blanking the list.
  useEffect(() => {
    const q = query.trim();
    const id = ++searchIdRef.current;

    const timer = setTimeout(async () => {
      if (!q) {
        setSearchResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      setSearching(true);
      try {
        const rows = await listConversations(q);
        if (searchIdRef.current !== id) return; // stale response
        setSearchResults(rows);
        setSearchError(null);
      } catch (err) {
        if (searchIdRef.current !== id) return;
        setSearchError(err?.message || "Search failed");
      } finally {
        if (searchIdRef.current === id) setSearching(false);
      }
    }, q ? 300 : 0);

    return () => clearTimeout(timer);
  }, [query]);

  const visible = useMemo(() => {
    const source = isSearching ? searchResults : conversations;
    return source.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "flagged" && !c.flagged) return false;
      return true;
    });
  }, [isSearching, searchResults, conversations, filter]);

  function toggleFlag(event, conversation) {
    // Don't let the click fall through to the row's open handler.
    event.stopPropagation();
    const flagged = !conversation.flagged;
    setFlagged(conversation.id, flagged);
    // Keep the search rows in step with the shared store.
    setSearchResults((prev) =>
      prev.map((c) => (c.id === conversation.id ? { ...c, flagged } : c))
    );
  }

  function openConversation(id) {
    markRead(id);
    // Clear the tapped row's unread locally so search rows match the badge.
    setSearchResults((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );
    navigate(`/conversation/${encodeURIComponent(id)}`);
  }

return (
  <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
    <ScreenHeader title="Inbox">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages and contacts"
            className="pl-9 pr-9"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="w-full mb-3">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread ({counts.unread})</TabsTrigger>
            <TabsTrigger value="flagged">Flagged ({counts.flagged})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </ScreenHeader>

      {/* Quiet inline note when the last search attempt failed (results stay). */}
      {searchError && isSearching && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Search didn't complete: {searchError}
        </p>
      )}

      {/* Conversation list */}
      {loading && !isSearching ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading conversations…
        </div>
      ) : visible.length > 0 ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/60"
            >
              <Avatar className="size-11">
                <AvatarFallback>
                  {c.isGroup ? <Users className="size-5" /> : initials(c.name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      c.unread > 0 ? "font-semibold" : "font-medium"
                    )}
                  >
                    {c.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.isGroup && (
                      <Badge variant="secondary" className="shrink-0">
                        Group
                      </Badge>
                    )}
                    <Flag
                      onClick={(e) => toggleFlag(e, c)}
                      title={c.flagged ? "Remove flag" : "Flag conversation"}
                      className={cn(
                        "size-3.5 shrink-0 cursor-pointer",
                        c.flagged
                          ? "fill-current text-destructive"
                          : "text-muted-foreground/40 hover:text-muted-foreground"
                      )}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.time}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <p
                    className={cn(
                      "line-clamp-1 flex-1 text-sm",
                      c.unread > 0
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {previewOf(c)}
                  </p>
                  {c.unread > 0 && (
                    <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5">
                      {c.unread}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          {searching ? (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">Searching…</p>
              <p className="text-sm text-muted-foreground">
                Looking through messages and contacts.
              </p>
            </>
          ) : searchError ? (
            <>
              <Inbox className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Search failed</p>
              <p className="text-sm text-muted-foreground">{searchError}</p>
            </>
          ) : (
            <>
              <Inbox className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">{emptyCopy.title}</p>
              <p className="text-sm text-muted-foreground">{emptyCopy.detail}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}