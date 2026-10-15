import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Gamepad2,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  SkipForward,
  Trash2,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import ScreenHeader from "@/components/ScreenHeader";
import { listGames, cancelGame, listGameGroups, updateGame } from "@/lib/api";
import { useInboxEventsListener } from "@/context/InboxEventsContext";

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
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

  // A missed SSE frame would otherwise leave stale counts (e.g. players who
  // just voted "I'm in") on the cards — refetch whenever the tab comes back.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refresh]);

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

      {/* The available-games list: only RoninClash exists for now. The whole
          card navigates to its route (/game/roninclash). */}
      <Link
        to="/game/roninclash"
        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="overflow-hidden transition-colors hover:border-ring/40">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent">
                <Gamepad2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle>RoninClash</CardTitle>
                <CardDescription>
                  Kahoot like Group trivia : players join with a poll, answer each question as a
                  private DM poll, and score points for speed and accuracy.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardFooter className="">
            {/* Visual CTA only — the surrounding Link is the actual target. */}
            <span className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              <Plus className="size-4" />
              Schedule game
            </span>
          </CardFooter>
        </Card>
      </Link>

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
                    onSaved={refresh}
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
                <Button onClick={() => navigate("/game/roninclash")} className="mt-4">
                  <Plus className="mr-2 size-4" />
                  Schedule a game
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** Hard ceiling mirrored from the backend validation. */
const MAX_FLOW_SECONDS = 3600;

/** A game's question-flow settings as editable string form state. */
function flowDraft(game) {
  return {
    questionTimeSeconds:
      game.questionTimeSeconds == null ? "" : String(game.questionTimeSeconds),
    betweenQuestionsSeconds: String(game.betweenQuestionsSeconds ?? 6),
    groupToDmDelaySeconds: String(game.groupToDmDelaySeconds ?? 5),
    advanceMode: game.advanceMode ?? "auto",
    dmQuestionVisibility: game.dmQuestionVisibility ?? "shown",
  };
}

/** True for a whole number of seconds within [min, MAX_FLOW_SECONDS]. */
function isWholeSeconds(value, min) {
  return (
    value !== "" &&
    Number.isInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= MAX_FLOW_SECONDS
  );
}

/** The popover form for a game's five question-flow settings. */
function FlowEditPopover({
  game,
  open,
  onOpenChange,
  draft,
  setDraft,
  draftValid,
  saving,
  saveError,
  onSave,
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label="Edit question flow" />}
      >
        <Pencil className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Question flow</p>
          <p className="text-xs text-muted-foreground">
            {game.status === "scheduled"
              ? "Applied as soon as the game starts."
              : "Applies from the next question forward."}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${game.id}-qtime`}>Question time (sec)</Label>
          <Input
            id={`${game.id}-qtime`}
            type="number"
            min={1}
            max={MAX_FLOW_SECONDS}
            value={draft.questionTimeSeconds}
            placeholder="Use each question's sheet value"
            onChange={(e) =>
              setDraft((d) => ({ ...d, questionTimeSeconds: e.target.value }))
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${game.id}-between`}>Pause (sec)</Label>
            <Input
              id={`${game.id}-between`}
              type="number"
              min={0}
              max={MAX_FLOW_SECONDS}
              value={draft.betweenQuestionsSeconds}
              onChange={(e) =>
                setDraft((d) => ({ ...d, betweenQuestionsSeconds: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${game.id}-g2d`}>Group → DM (sec)</Label>
            <Input
              id={`${game.id}-g2d`}
              type="number"
              min={0}
              max={MAX_FLOW_SECONDS}
              value={draft.groupToDmDelaySeconds}
              onChange={(e) =>
                setDraft((d) => ({ ...d, groupToDmDelaySeconds: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Advance mode</Label>
          <Select
            value={draft.advanceMode}
            onValueChange={(v) => setDraft((d) => ({ ...d, advanceMode: v }))}
            items={[
              { value: "auto", label: "Auto — after the pause" },
              { value: "manual", label: "Manual — .next" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto — after the pause</SelectItem>
              <SelectItem value="manual">Manual — .next</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>DM poll wording</Label>
          <Select
            value={draft.dmQuestionVisibility}
            onValueChange={(v) => setDraft((d) => ({ ...d, dmQuestionVisibility: v }))}
            items={[
              { value: "shown", label: "Show the question" },
              { value: "hidden", label: "Number only (Q1, Q2…)" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shown">Show the question</SelectItem>
              <SelectItem value="hidden">Number only (Q1, Q2…)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!draftValid && (
          <p className="text-xs text-destructive">
            Times must be whole seconds (question time ≥ 1, pauses ≥ 0, all ≤{" "}
            {MAX_FLOW_SECONDS}).
          </p>
        )}
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        <Button className="w-full" disabled={!draftValid || saving} onClick={onSave}>
          {saving ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 size-4" />
          )}
          Save flow settings
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function GameCard({ game, groupName, onDelete, onSaved }) {
  const variant = STATUS_VARIANT[game.status] ?? "default";
  const label = STATUS_LABEL[game.status] ?? game.status;
  const group = groupName ?? game.groupName;
  const editable = ["scheduled", "lobby", "running"].includes(game.status);
  const manualLive = game.status === "running" && game.advanceMode === "manual";

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(() => flowDraft(game));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [nexting, setNexting] = useState(false);
  const [nextError, setNextError] = useState("");

  // Opening the popover samples the latest game (a background refetch may have
  // changed it), so the draft is never stale when an edit begins.
  function handleEditOpenChange(open) {
    if (open) setDraft(flowDraft(game));
    setEditOpen(open);
  }

  const draftValid =
    (draft.questionTimeSeconds === "" ||
      isWholeSeconds(draft.questionTimeSeconds, 1)) &&
    isWholeSeconds(draft.betweenQuestionsSeconds, 0) &&
    isWholeSeconds(draft.groupToDmDelaySeconds, 0);

  /** Saves the five question-flow fields (all a live game may change). */
  async function handleSave() {
    if (!draftValid || saving) return;
    setSaving(true);
    setSaveError("");
    const res = await updateGame(game.id, {
      questionTimeSeconds:
        draft.questionTimeSeconds === "" ? null : Number(draft.questionTimeSeconds),
      betweenQuestionsSeconds: Number(draft.betweenQuestionsSeconds),
      groupToDmDelaySeconds: Number(draft.groupToDmDelaySeconds),
      advanceMode: draft.advanceMode,
      dmQuestionVisibility: draft.dmQuestionVisibility,
    });
    setSaving(false);
    if (res.ok) {
      setEditOpen(false);
      onSaved?.();
    } else {
      setSaveError(res.error || "Couldn't save the question flow.");
    }
  }

  /** The dashboard side of manual advance (`{ action: "next" }`). */
  async function handleNext() {
    if (nexting) return;
    setNexting(true);
    setNextError("");
    const res = await updateGame(game.id, { action: "next" });
    setNexting(false);
    if (res.ok) onSaved?.();
    else setNextError(res.error || "Couldn't advance to the next question.");
  }

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
              {editable && (
                <span className="flex items-center gap-1" title="Question-flow settings">
                  <Settings2 className="size-3" />
                  {game.questionTimeSeconds ? `${game.questionTimeSeconds}s` : "Sheet"} ·{" "}
                  {game.advanceMode === "manual" ? "Manual" : "Auto"}
                </span>
              )}
              {game.hasPassword && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-3" />
                  Password set
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editable && (
              <FlowEditPopover
                game={game}
                open={editOpen}
                onOpenChange={handleEditOpenChange}
                draft={draft}
                setDraft={setDraft}
                draftValid={draftValid}
                saving={saving}
                saveError={saveError}
                onSave={handleSave}
              />
            )}
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
        </div>
      </CardHeader>
      {game.status === "running" && (
        <CardFooter className="pt-0 border-t bg-muted/30">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {manualLive ? (
                <>
                  Waiting for the host — send{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    .next
                  </code>{" "}
                  in the group, or press Next question.
                </>
              ) : (
                "Game is live — questions are being sent to players."
              )}
            </div>
            {manualLive && (
              <Button size="sm" onClick={handleNext} disabled={nexting}>
                {nexting ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <SkipForward className="mr-1.5 size-4" />
                )}
                Next question
              </Button>
            )}
          </div>
          {nextError && <p className="w-full text-xs text-destructive">{nextError}</p>}
        </CardFooter>
      )}
    </Card>
  );
}