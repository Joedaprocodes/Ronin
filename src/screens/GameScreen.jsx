import { useCallback, useEffect, useState } from "react";
import { Gamepad2, Loader2, Plus, Trash2, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ScreenHeader from "@/components/ScreenHeader";
import { listGames, cancelGame, listGameGroups } from "@/lib/api";
import { useInboxEventsListener } from "@/context/InboxEventsContext";
import RoninClashScreen from "./RoninClashScreen";

const STATUS_VARIANT = {
  scheduled: "default",
  lobby: "secondary",
  running: "default",
  finished: "outline",
  cancelled: "destructive",
};

const STATUS_LABEL = {
  scheduled: "Scheduled",
  lobby: "Open for join",
  running: "Live",
  finished: "Finished",
  cancelled: "Cancelled",
};

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusDot(variant) {
  const base = "w-2 h-2 rounded-full";
  const map = {
    default: "bg-primary",
    secondary: "bg-blue-500",
    outline: "bg-muted-foreground",
    destructive: "bg-destructive",
  };
  return <span className={cn(base, map[variant] ?? map.default)} />;
}

export default function GameScreen() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [groupNames, setGroupNames] = useState({});

  // Groups give the cards display names (the API only stores the group jid).
  useEffect(() => {
    let active = true;
    listGameGroups()
      .then((list) => {
        if (!active) return;
        setGroupNames(Object.fromEntries(list.map((g) => [g.jid, g.name])));
      })
      .catch(() => {
        // cosmetic only — cards fall back to the raw jid
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(() => {
    listGames()
      .then((list) => {
        setGames(list);
        setError("");
      })
      .catch((err) => {
        setError(err?.message || "Couldn't load games.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live game events (joined/left/started/question/leaderboard/finished) don't
  // carry the full row, so refetch the list on any of them.
  useInboxEventsListener((payload) => {
    if (payload?.type !== "game") return;
    refresh();
  });

  async function handleDelete(id) {
    if (!window.confirm("Delete this game? Players and answers will be removed.")) return;
    const res = await cancelGame(id);
    if (res.ok) {
      setGames((prev) => prev.filter((g) => g.id !== id));
    } else {
      alert(res.error || "Couldn't delete game.");
    }
  }

  const scheduled = games.filter((g) => g.status === "scheduled");
  const lobby = games.filter((g) => g.status === "lobby");
  const running = games.filter((g) => g.status === "running");
  const finished = games.filter((g) => g.status === "finished");
  const cancelled = games.filter((g) => g.status === "cancelled");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader title="Game" subtitle="RoninClash trivia" />

      {/* The available-games list. Only RoninClash exists for now; opening it
          shows the "Schedule game" form. */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent">
              <Gamepad2 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>RoninClash</CardTitle>
              <CardDescription>
                Group trivia: players join with a poll, answer each question as a
                private DM poll, and score points for speed and accuracy.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardFooter className="pt-0">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 size-4" />
            Schedule game
          </Button>
        </CardFooter>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          {[
            { label: "Scheduled", items: scheduled },
            { label: "Open for join", items: lobby },
            { label: "Live", items: running },
            { label: "Finished", items: finished },
            { label: "Cancelled", items: cancelled },
          ].map((section) =>
            section.items.length ? (
              <div key={section.label} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {section.label}
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-muted text-xs">
                    {section.items.length}
                  </span>
                </div>
                {section.items.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    groupName={groupNames[game.groupJid] ?? null}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : null
          )}

          {!games.length && (
            <Card className="text-center py-8">
              <CardContent>
                <Gamepad2 className="mx-auto size-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No games yet.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Tap "Schedule" to create your first RoninClash trivia round.
                </p>
                <Button onClick={() => setShowCreate(true)} className="mt-4">
                  <Plus className="mr-2 size-4" />
                  Schedule a game
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {showCreate && (
        <RoninClashScreen
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}

function GameCard({ game, groupName, onDelete }) {
  const variant = STATUS_VARIANT[game.status] ?? "default";
  const label = STATUS_LABEL[game.status] ?? game.status;
  const group = groupName ?? game.groupName;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate">{game.title}</CardTitle>
              <Badge variant={variant} className="flex items-center gap-1">
                {statusDot(variant)}
                {label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {group ? `${group} ` : ""}({game.groupJid})
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                Starts {formatWhen(game.startAt)}
              </span>
              <span className="flex items-center gap-1">
                <Gamepad2 className="size-3" />
                {game.questionCount} Q
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="size-3" />
                {game.playerCount} players
              </span>
              {game.hasPassword && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-3" />
                  Password set
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(game.id)}
            className="text-destructive hover:bg-destructive/10 shrink-0"
            aria-label="Delete game"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      {game.status === "running" && (
        <CardFooter className="pt-0 border-t bg-muted/30">
          <div className="text-xs text-muted-foreground">
            Game is live — questions are being sent to players.
          </div>
        </CardFooter>
      )}
    </Card>
  );
}