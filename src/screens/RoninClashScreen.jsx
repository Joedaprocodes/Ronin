import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Lock,
  Upload,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import ScreenHeader from "@/components/ScreenHeader";
import { createGame, listGameGroups } from "@/lib/api";
import { parseQuestionsFile } from "@/lib/gameQuestions";

/** Below this delay WhatsApp is far more likely to flag bulk DMs — warn only. */
const RISKY_DELAY_SECONDS = 5;
/** Hard ceiling mirrored from the backend validation. */
const MAX_DELAY_SECONDS = 3600;

/** Local YYYY-MM-DD / HH:MM for "now + 10 minutes" (date/time input values). */
function defaultDateTime() {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Picker label for a group: name (member count), jid as the fallback. */
function groupLabel(group) {
  const name = group.name?.trim() || group.jid;
  return group.memberCount ? `${name} (${group.memberCount} members)` : name;
}

/** Human-readable start time for the review card. */
function formatStart(dateStr, timeStr) {
  const at = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * RoninClash "Schedule game" form at /game/roninclash — a normal routed screen
 * (the back arrow returns to /game, which refetches on mount so a newly
 * scheduled game shows up immediately under "Scheduled").
 *
 * The .xlsx spreadsheet is parsed and validated on upload: row-level errors
 * are listed and Confirm stays disabled until the sheet is clean. Once saved,
 * the start password is only ever shown masked — the API never returns it
 * again (the server view exposes `hasPassword` only).
 */
export default function RoninClashScreen() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");

  const [title, setTitle] = useState("");
  const [groupJid, setGroupJid] = useState("");
  const [password, setPassword] = useState("");
  const initial = defaultDateTime();
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [minDelay, setMinDelay] = useState("8");
  const [maxDelay, setMaxDelay] = useState("15");
  // Question flow: timing override, pause, advance mode, group→DM delay and
  // what the DM poll names show. The question-time override sits behind its
  // own toggle so it only shows (and applies) when switched on.
  const [questionTimeEnabled, setQuestionTimeEnabled] = useState(false);
  const [questionTime, setQuestionTime] = useState("30");
  const [betweenQuestions, setBetweenQuestions] = useState("30");
  const [advanceMode, setAdvanceMode] = useState("auto");
  const [groupToDmDelay, setGroupToDmDelay] = useState("5");
  const [dmVisibility, setDmVisibility] = useState("shown");

  const [fileName, setFileName] = useState("");
  const [questions, setQuestions] = useState([]);
  const [rowErrors, setRowErrors] = useState([]); // { row, errors: string[] }
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [serverRowErrors, setServerRowErrors] = useState([]); // { row, message }
  const [saved, setSaved] = useState(null); // created game -> success view
  // Groups the linked account is in (same source as guards/automation).
  useEffect(() => {
    let active = true;
    listGameGroups()
      .then((list) => {
        if (!active) return;
        setGroups(list);
        setGroupsError("");
      })
      .catch((err) => {
        if (!active) return;
        const status = err?.status;
        setGroupsError(
          status === 409
            ? "WhatsApp is not connected — link the device first."
            : status === 503
              ? "No WhatsApp connection is configured on the server."
              : err?.message || "Couldn't load your groups."
        );
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const startAt = date && time ? new Date(`${date}T${time}`) : null;
  const startValid = Boolean(startAt) && !Number.isNaN(startAt.getTime());
  // A past start time is rejected in handleSubmit with a fresh clock — render
  // must stay pure, so no Date.now() here.

  const minNum = Number(minDelay);
  const maxNum = Number(maxDelay);
  const delaysValid =
    minDelay !== "" &&
    maxDelay !== "" &&
    Number.isInteger(minNum) &&
    Number.isInteger(maxNum) &&
    minNum >= 0 &&
    maxNum >= 0 &&
    minNum <= maxNum &&
    maxNum <= MAX_DELAY_SECONDS;
  const delayRisky = delaysValid && minNum < RISKY_DELAY_SECONDS;

  // Question-flow timings: whole seconds, same hard cap as the batch delays.
  // The override only validates (and applies) while its toggle is on.
  const questionTimeValid =
    !questionTimeEnabled ||
    (questionTime !== "" &&
      Number.isInteger(Number(questionTime)) &&
      Number(questionTime) >= 1 &&
      Number(questionTime) <= MAX_DELAY_SECONDS);
  const wholeSeconds = (value, min) =>
    value !== "" &&
    Number.isInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= MAX_DELAY_SECONDS;
  const betweenValid = advanceMode !== "auto" || wholeSeconds(betweenQuestions, 0);
  const groupToDmValid = wholeSeconds(groupToDmDelay, 0);
  const flowValid = questionTimeValid && betweenValid && groupToDmValid;

  const cleanSheet = questions.length > 0 && rowErrors.length === 0 && !parseError;

  const missing = [];
  if (!title.trim()) missing.push("a title");
  if (!groupJid) missing.push("a group");
  if (!password) missing.push("a start password");
  if (!startValid) missing.push("a valid start time");
  if (!cleanSheet) missing.push("a clean spreadsheet");
  if (!delaysValid) missing.push("valid delays (min ≤ max)");
  if (!flowValid) missing.push("valid question-flow timings");

  const canConfirm = missing.length === 0 && !submitting;
  /** Parses + validates the uploaded workbook; errors block confirming. */
  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again re-parses
    if (!file) return;
    setParsing(true);
    setParseError("");
    setRowErrors([]);
    setQuestions([]);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseQuestionsFile(buffer);
      setQuestions(result.questions);
      setRowErrors(result.rowErrors);
      if (!result.questions.length && !result.rowErrors.length) {
        setParseError("No questions found in the spreadsheet.");
      }
    } catch {
      setParseError("Couldn't read that file — upload a valid .xlsx spreadsheet.");
    } finally {
      setParsing(false);
    }
  }

  function clearSheet() {
    setFileName("");
    setQuestions([]);
    setRowErrors([]);
    setParseError("");
  }

  async function handleSubmit(event) {
    event?.preventDefault?.();
    if (!canConfirm) return;
    if (startAt.getTime() <= Date.now()) {
      // The render-time check uses the clock sampled at mount; re-check fresh.
      setSubmitError("Pick a start time in the future.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    setServerRowErrors([]);
    const result = await createGame({
      title: title.trim(),
      groupJid,
      password,
      startAt: startAt.toISOString(),
      minDelaySeconds: minNum,
      maxDelaySeconds: maxNum,
      questionTimeSeconds:
        questionTimeEnabled && questionTime !== "" ? Number(questionTime) : null,
      // The pause only applies to auto mode; omitted while manual so the
      // stored/default pause is untouched by the hidden field.
      ...(advanceMode === "auto"
        ? { betweenQuestionsSeconds: Number(betweenQuestions) }
        : {}),
      advanceMode,
      groupToDmDelaySeconds: Number(groupToDmDelay),
      dmQuestionVisibility: dmVisibility,
      questions,
    });
    setSubmitting(false);
    if (result.ok) {
      // The password is never rendered again — only `hasPassword` comes back.
      setSaved(result.game);
      return;
    }
    setSubmitError(result.error || "Couldn't schedule the game.");
    if (Array.isArray(result.rowErrors) && result.rowErrors.length) {
      setServerRowErrors(result.rowErrors);
    }
  }
  /* ------------------------------- success ------------------------------- */

  if (saved) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
        <ScreenHeader
          title="Game scheduled"
          subtitle="RoninClash trivia round"
          back="/game"
        />
        <div className="space-y-4">
          <Card>
            <CardHeader className="text-center">
              <CheckCircle2 className="mx-auto size-10 text-green-600 dark:text-green-500" />
              <CardTitle>Game scheduled</CardTitle>
              <CardDescription>
                “{saved.title}” was announced in the group. The join poll is posted at
                the start time — players vote “I&apos;m in” to register.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="divide-y divide-border rounded-lg border text-sm">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Questions</dt>
                  <dd className="font-medium">{saved.questionCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd className="font-medium">
                    {saved.startAt
                      ? new Date(saved.startAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Batch delay</dt>
                  <dd className="font-medium">
                    {saved.minDelaySeconds}–{saved.maxDelaySeconds}s
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Question flow</dt>
                  <dd className="font-medium">
                    {saved.questionTimeSeconds
                      ? `${saved.questionTimeSeconds}s questions`
                      : "Sheet times"}
                    {" · "}
                    {saved.groupToDmDelaySeconds}s group→DM ·{" "}
                    {saved.advanceMode === "manual" ? "manual .next" : "auto"}
                  </dd>
                </div>
              </dl>

              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Lock className="size-4 shrink-0" />
                  Start password:
                  <span className="font-mono tracking-[0.3em]">••••••••</span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  The password is masked and never shown again. Keep it secret — the
                  host starts the game from the group with{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {".start <password>"}
                  </code>
                  .
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={() => navigate("/game")}>
                Done
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }
  /* -------------------------------- form --------------------------------- */

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-4">
      <ScreenHeader
        title="Schedule game"
        subtitle="RoninClash trivia round"
        back="/game"
      />

      <div className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Details ------------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="game-title">Game title</Label>
                <Input
                  id="game-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Friday Night Trivia"
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">
                  Players see this title in the group announcements.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Target group</Label>
                {groupsLoading ? (
                  <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading groups…
                  </div>
                ) : groupsError ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {groupsError}
                  </p>
                ) : groups.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    The bot isn&apos;t in any group yet — add it to a group first.
                  </p>
                ) : (
                  <Select
                    value={groupJid || null}
                    onValueChange={setGroupJid}
                    items={groups.map((g) => ({ value: g.jid, label: groupLabel(g) }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a group" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...groups]
                        .sort((a, b) =>
                          groupLabel(a).localeCompare(groupLabel(b), undefined, { sensitivity: "base" })
                        )
                        .map((g) => (
                          <SelectItem key={g.jid} value={g.jid}>
                            {groupLabel(g)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="game-password">Start password</Label>
                <Input
                  id="game-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={64}
                  autoComplete="new-password"
                  placeholder="Secret word"
                />
                <p className="text-xs text-muted-foreground">
                  The host sends{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {".start <password>"}
                  </code>{" "}
                  in the group to begin. Masked once saved.
                </p>
              </div>
            </CardContent>
          </Card>
          {/* Questions ----------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Questions</CardTitle>
              <CardDescription>
                Kahoot layout:{" "}
                <span className="font-mono text-xs">
                  #, Question, Answer 1–4, Time limit (sec), Correct answer(s)
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsing}
                >
                  {parsing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 size-4" />
                  )}
                  {fileName ? "Replace spreadsheet" : "Upload spreadsheet"}
                </Button>
                {fileName && (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <FileSpreadsheet className="size-4 shrink-0" />
                    <span className="truncate">{fileName}</span>
                  </span>
                )}
                {fileName && !parsing && (
                  <Button type="button" variant="ghost" size="sm" onClick={clearSheet}>
                    Clear
                  </Button>
                )}
              </div>

              {parseError && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {parseError}
                </p>
              )}

              {rowErrors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="size-4 shrink-0" />
                    Fix {rowErrors.length} row{rowErrors.length === 1 ? "" : "s"} before
                    confirming
                  </p>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-destructive/90">
                    {rowErrors.map((err) => (
                      <li key={err.row}>
                        {err.errors.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {questions.length > 0 && rowErrors.length === 0 && !parseError && (
                <p className="flex items-center gap-2 rounded-lg bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  {questions.length} question{questions.length === 1 ? "" : "s"} parsed
                  and validated.
                </p>
              )}
            </CardContent>
          </Card>
          {/* Timing -------------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Start &amp; delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="game-date">Start date</Label>
                  <Input
                    id="game-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="game-time">Start time</Label>
                  <Input
                    id="game-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>
              {date && time && !startValid && (
                <p className="text-xs text-destructive">
                  That date/time isn&apos;t valid — pick a real start time.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="game-min">Min delay (sec)</Label>
                  <Input
                    id="game-min"
                    type="number"
                    min={0}
                    max={MAX_DELAY_SECONDS}
                    value={minDelay}
                    onChange={(e) => setMinDelay(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="game-max">Max delay (sec)</Label>
                  <Input
                    id="game-max"
                    type="number"
                    min={0}
                    max={MAX_DELAY_SECONDS}
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Random wait between each batch of 10 question polls DM&apos;d to players.
              </p>
              {!delaysValid && (
                <p className="text-xs text-destructive">
                  Delays must be whole seconds between 0 and {MAX_DELAY_SECONDS}, with
                  min ≤ max.
                </p>
              )}
              {delayRisky && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Very low delays raise the risk of WhatsApp flagging or banning the
                  linked number. 5s+ is safer; 15–30s is comfortable.
                </p>
              )}
            </CardContent>
          </Card>
          {/* Question flow ------------------------------------------------ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Question flow</CardTitle>
              <CardDescription>
                How questions are timed and handed from the group to players&apos; DMs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor="game-qtime-toggle" className="flex-1 cursor-pointer">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Override question time</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Use one time limit for every question instead of each row&apos;s
                        &quot;Time limit (sec)&quot;.
                      </span>
                    </span>
                  </Label>
                  <Switch
                    id="game-qtime-toggle"
                    checked={questionTimeEnabled}
                    onCheckedChange={setQuestionTimeEnabled}
                  />
                </div>
                {questionTimeEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="game-qtime">Question time (sec)</Label>
                    <Input
                      id="game-qtime"
                      type="number"
                      min={1}
                      max={MAX_DELAY_SECONDS}
                      value={questionTime}
                      onChange={(e) => setQuestionTime(e.target.value)}
                      placeholder="e.g. 30"
                    />
                    {!questionTimeValid && (
                      <p className="text-xs text-destructive">
                        Use a whole number between 1 and {MAX_DELAY_SECONDS}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="game-manual" className="flex-1 cursor-pointer">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Manual advance (.next)</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Off (auto): the next question starts after the pause below. On: the
                      game waits for the host or a group admin to send{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        .next
                      </code>{" "}
                      and the pause setting stays hidden.
                    </span>
                  </span>
                </Label>
                <Switch
                  id="game-manual"
                  checked={advanceMode === "manual"}
                  onCheckedChange={(v) => setAdvanceMode(v ? "manual" : "auto")}
                />
              </div>

              <div className={advanceMode === "auto" ? "grid grid-cols-2 gap-3" : ""}>
                {advanceMode === "auto" && (
                  <div className="space-y-2">
                    <Label htmlFor="game-between">Pause between questions (sec)</Label>
                    <Input
                      id="game-between"
                      type="number"
                      min={0}
                      max={MAX_DELAY_SECONDS}
                      value={betweenQuestions}
                      onChange={(e) => setBetweenQuestions(e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="game-g2d">Group text → DM delay (sec)</Label>
                  <Input
                    id="game-g2d"
                    type="number"
                    min={0}
                    max={MAX_DELAY_SECONDS}
                    value={groupToDmDelay}
                    onChange={(e) => setGroupToDmDelay(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each question is posted to the group first; the answer polls arrive in
                DMs after the group→DM delay. The pause between questions runs after each
                leaderboard and only applies while auto is on.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor="game-dmwords" className="flex-1 cursor-pointer">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Show question wording in DM polls
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Off: DM polls show only the number (Q1, Q2…). The group always
                        sees the full question either way.
                      </span>
                    </span>
                  </Label>
                  <Switch
                    id="game-dmwords"
                    checked={dmVisibility === "shown"}
                    onCheckedChange={(v) => setDmVisibility(v ? "shown" : "hidden")}
                  />
                </div>
              </div>
              {!flowValid && (
                <p className="text-xs text-destructive">
                  Pauses must be whole seconds between 0 and {MAX_DELAY_SECONDS}.
                </p>
              )}
            </CardContent>
          </Card>
          {/* Review -------------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Review</CardTitle>
              <CardDescription>
                What players will see before you confirm.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border rounded-lg border text-sm">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="truncate font-medium">{title.trim() || "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Group</dt>
                  <dd className="truncate font-medium">
                    {groupJid
                      ? groups.find((g) => g.jid === groupJid)?.name?.trim() || groupJid
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Questions</dt>
                  <dd className="font-medium">{questions.length || "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd className="font-medium">
                    {startValid ? formatStart(date, time) : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Batch delay</dt>
                  <dd className="font-medium">
                    {delaysValid ? `${minNum}–${maxNum}s` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Question time</dt>
                  <dd className="font-medium">
                    {!questionTimeEnabled
                      ? "From sheet"
                      : questionTime === ""
                        ? "—"
                        : `${questionTime}s`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Question flow</dt>
                  <dd className="font-medium">
                    {flowValid
                      ? `${advanceMode === "auto" ? `${betweenQuestions}s pause · ` : ""}${groupToDmDelay}s group→DM`
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Advance</dt>
                  <dd className="font-medium">
                    {advanceMode === "manual" ? "Manual (.next)" : "Auto"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">DM poll wording</dt>
                  <dd className="font-medium">
                    {dmVisibility === "hidden" ? "Number only" : "Question shown"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {submitError && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {submitError}
              {serverRowErrors.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {serverRowErrors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/game")}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canConfirm} className="flex-1">
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 size-4" />
              )}
              Confirm and schedule
            </Button>
          </div>
          {missing.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Still needed: {missing.join(", ")}.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
