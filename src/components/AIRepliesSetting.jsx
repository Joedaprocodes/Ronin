import { useState } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_MODEL,
  GEMINI_KEY_URL,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/ai";

/**
 * Settings control: turn AI replies on/off and store the Gemini API key.
 *
 * The key lives in this browser's localStorage — it never touches the backend
 * and is only ever sent to Google's Generative Language API — so it is
 * per-device and easy to rotate. Renders its own Card.
 */
export default function AIRepliesSetting() {
  const [settings, setSettings] = useState(loadAiSettings);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [touched, setTouched] = useState(false);

  const nextKey = apiKey.trim();
  const nextModel = model.trim() || DEFAULT_MODEL;
  const dirty = nextKey !== settings.apiKey || nextModel !== settings.model;

  function persist() {
    setSettings(saveAiSettings({ apiKey: nextKey, model: nextModel }));
    setTouched(true);
  }

  function toggle(checked) {
    setSettings(saveAiSettings({ enabled: checked }));
    setTouched(true);
  }

  const configured = Boolean(settings.apiKey);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI replies</CardTitle>
        <CardDescription>
          Draft a reply in a tone you pick, from inside a chat.
        </CardDescription>
        <CardAction>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) => toggle(checked)}
            aria-label="Enable AI replies"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="ai-api-key">Gemini API key</Label>
          <div className="flex items-center gap-2">
            <Input
              id="ai-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your API key"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={showKey ? "Hide API key" : "Show API key"}
              title={showKey ? "Hide API key" : "Show API key"}
              onClick={() => setShowKey((current) => !current)}
            >
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved only on this device and sent straight to Google. Create one at{" "}
            <a
              href={GEMINI_KEY_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              aistudio.google.com/apikey
            </a>
            .
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="ai-model">Model</Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={DEFAULT_MODEL}
            spellCheck={false}
            className="font-mono"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={persist} disabled={!dirty}>
            Save
          </Button>
          {touched && !dirty ? (
            <span className="text-xs text-muted-foreground">Saved</span>
          ) : null}
        </div>

        <p className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {!settings.enabled
            ? "Turned off — the AI reply button stays hidden in chats."
            : configured
              ? "Look for the ✨ button beside the message box in any chat."
              : "Add an API key above to start drafting replies."}
        </p>
      </CardContent>
    </Card>
  );
}
