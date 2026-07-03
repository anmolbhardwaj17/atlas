"use client";

import * as React from "react";
import { Sparkles, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setLlmSettings, deleteLlmSettings, type LlmSettings } from "@/lib/browser-api";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
// A few good OpenRouter model ids to suggest; users can type any (openrouter.ai/models).
const SUGGESTED = [
  DEFAULT_MODEL,
  "openai/gpt-4o",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-chat",
];

/**
 * BYO-LLM: point Ask AI at your own model via OpenRouter (docs/10 §3). The key is sent once to
 * be stored encrypted server-side; it's never returned or shown again (only provider + model are).
 * Admin-only. Without this, Ask AI uses the platform default.
 */
export function LlmSettingsCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: LlmSettings | null;
}) {
  const [current, setCurrent] = React.useState<LlmSettings | null>(initial);
  const [model, setModel] = React.useState(initial?.model ?? DEFAULT_MODEL);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function save() {
    if (!model.trim() || !apiKey.trim()) {
      setMsg({ tone: "warn", text: "Enter a model and your OpenRouter API key." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const saved = await setLlmSettings(orgId, model.trim(), apiKey.trim());
      setCurrent(saved);
      setApiKey("");
      setMsg({ tone: "ok", text: `Saved - Ask AI now uses ${saved.model} via OpenRouter.` });
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't save the model." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      await deleteLlmSettings(orgId);
      setCurrent(null);
      setMsg({ tone: "ok", text: "Removed - Ask AI is back on the platform default." });
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't remove the model." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Ask AI model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Bring your own model for Ask AI via{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
          >
            OpenRouter <ExternalLink className="size-3" />
          </a>
          . Atlas answers stay grounded in your graph and cited - the model only narrates. Your key
          is stored encrypted and never shown again.
        </p>

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          {current ? (
            <span>
              Currently using <span className="font-medium">{current.model}</span> via OpenRouter.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Using the platform default. Add an OpenRouter key to use your own model.
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Model</span>
            <Input
              list="openrouter-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="anthropic/claude-sonnet-4"
            />
            <datalist id="openrouter-models">
              {SUGGESTED.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">OpenRouter API key</span>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current ? "•••••••• (enter to replace)" : "sk-or-..."}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => void save()} disabled={busy} size="sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {current ? "Update model" : "Save model"}
          </Button>
          {current ? (
            <Button onClick={() => void remove()} disabled={busy} size="sm" variant="ghost">
              Remove
            </Button>
          ) : null}
          {msg ? (
            <span className={`text-xs ${msg.tone === "ok" ? "text-success" : "text-warning"}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
