import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Plus,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import ScreenHeader from "@/components/ScreenHeader";

/* -------------------------------------------------------------------------- */
/*  Mock data — swap for the backend's status feed once it exists.            */
/*  One update = one contact with one or more items (WhatsApp groups a        */
/*  contact's items into a single ring/thread).                              */
/* -------------------------------------------------------------------------- */

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

const MY_STATUS = {
  id: "me",
  name: "My status",
  seen: true,
  items: [
    {
      id: "me-1",
      type: "text",
      text: "Shipping the Status tab 👀",
      bg: "#008069",
      at: hoursAgo(0.2),
    },
  ],
};

const UPDATES = [
  {
    id: "u1",
    name: "Joshua Ayeni",
    seen: false,
    items: [
      {
        id: "u1-1",
        type: "text",
        text: "Building in public 🚀",
        bg: "#128C7E",
        at: hoursAgo(0.5),
      },
      {
        id: "u1-2",
        type: "image",
        caption: "Tesa Conf 2026",
        bg: "#1f2c34",
        at: hoursAgo(0.6),
      },
    ],
  },
  {
    id: "u2",
    name: "Emma Okoye",
    seen: false,
    items: [
      { id: "u2-1", type: "text", text: "Lagos traffic 😭", bg: "#075E54", at: hoursAgo(3) },
    ],
  },
  {
    id: "u3",
    name: "Tunde Bello",
    seen: true,
    items: [
      { id: "u3-1", type: "image", caption: "Sunset 🌇", bg: "#0b141a", at: hoursAgo(27) },
    ],
  },
];

function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** Compact relative label for the list ("now", "5m", "3h", "2d"). */
function shortAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The story body: a coloured text card or an image placeholder. */
function StatusBody({ item }) {
  if (item.type === "image") {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ backgroundColor: item.bg ?? "#111" }}
      >
        <ImageIcon className="size-12 opacity-60" />
        <p className="text-lg font-medium leading-snug">{item.caption}</p>
        <p className="text-xs opacity-60">Image status (placeholder)</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 items-center justify-center px-10 text-center"
      style={{ backgroundColor: item.bg ?? "#075E54" }}
    >
      <p className="text-xl font-medium leading-snug">{item.text}</p>
    </div>
  );
}

export default function StatusScreen() {
  const [updates, setUpdates] = useState(UPDATES);
  const [viewer, setViewer] = useState(null); // { contactId, index }

  const activeContact = viewer
    ? viewer.contactId === MY_STATUS.id
      ? MY_STATUS
      : updates.find((u) => u.id === viewer.contactId) ?? null
    : null;
  const item = activeContact?.items[viewer?.index ?? 0] ?? null;

  function openViewer(contact) {
    setViewer({ contactId: contact.id, index: 0 });
    setUpdates((prev) =>
      prev.map((u) => (u.id === contact.id ? { ...u, seen: true } : u))
    );
  }

  function step(delta) {
    setViewer((prev) => {
      if (!prev) return prev;
      const contact = prev.contactId === MY_STATUS.id
        ? MY_STATUS
        : updates.find((u) => u.id === prev.contactId);
      const next = prev.index + delta;
      if (!contact || next < 0 || next >= contact.items.length) return prev;
      return { ...prev, index: next };
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader title="Status" />

      {/* My status */}
      <button
        type="button"
        onClick={() => openViewer(MY_STATUS)}
        className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="relative">
          <Avatar className="size-11">
            <AvatarFallback>{initials("Joshua Ayeni")}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Plus className="size-3.5" />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">My status</span>
          <span className="block truncate text-xs text-muted-foreground">
            {MY_STATUS.items.length} update · {shortAgo(MY_STATUS.items[0].at)}
          </span>
        </span>
      </button>

      {/* Recent updates */}
      <div>
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent updates
        </p>

        {updates.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            No recent updates.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            {updates.map((contact, index) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => openViewer(contact)}
                className={cn(
                  "flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50",
                  index > 0 && "border-t"
                )}
              >
                <span
                  className={cn(
                    "rounded-full p-[2px]",
                    contact.seen ? "bg-border" : "bg-primary"
                  )}
                >
                  <span className="block rounded-full bg-background p-[2px]">
                    <Avatar className="size-11">
                      <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                    </Avatar>
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {contact.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {contact.items.length} update
                    {contact.items.length === 1 ? "" : "s"} ·{" "}
                    {shortAgo(contact.items[contact.items.length - 1].at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Viewer — a card floating in the middle of the screen */}
      <Sheet
        open={Boolean(viewer)}
        onOpenChange={(open) => {
          if (!open) setViewer(null);
        }}
      >
        <SheetContent
          side="center"
          showCloseButton={false}
          className="left-1/2 top-1/2 w-[min(92vw,26rem)] max-h-[85svh] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-xl bg-neutral-900 p-0 text-white shadow-xl"
        >
          <SheetTitle className="sr-only">
            {activeContact?.name ?? "Status"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Status update viewer
          </SheetDescription>

          {activeContact && item && (
            <div className="flex h-[min(65svh,32rem)] flex-col">
              {/* Progress segments */}
              <div className="flex gap-1 px-3 pt-3">
                {activeContact.items.map((it, idx) => (
                  <span
                    key={it.id}
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      idx <= viewer.index ? "bg-white/90" : "bg-white/25"
                    )}
                  />
                ))}
              </div>

              {/* Header */}
              <div className="flex items-center gap-3 px-3 py-3">
                <Avatar className="size-9">
                  <AvatarFallback>{initials(activeContact.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {activeContact.name}
                  </p>
                  <p className="text-xs text-white/60">{timeLabel(item.at)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  className="text-white hover:bg-white/10"
                  onClick={() => setViewer(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>

              {/* Body */}
              <StatusBody item={item} />

              {/* Prev / next */}
              <div className="flex items-center justify-between px-3 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous update"
                  className="text-white hover:bg-white/10"
                  onClick={() => step(-1)}
                  disabled={viewer.index === 0}
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <span className="text-xs text-white/60">
                  {viewer.index + 1} / {activeContact.items.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next update"
                  className="text-white hover:bg-white/10"
                  onClick={() => step(1)}
                  disabled={viewer.index === activeContact.items.length - 1}
                >
                  <ChevronRight className="size-5" />
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
