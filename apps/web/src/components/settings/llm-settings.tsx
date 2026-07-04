"use client";

import * as React from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { AtlasAiMark } from "@/components/brand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { ProviderIcon } from "@/components/settings/provider-icon";
import { setLlmSettings, deleteLlmSettings, type LlmSettings } from "@/lib/browser-api";

type Model = { id: string; label: string };
type Group = { title: string; models: Model[] };
interface ProviderCfg {
  id: string;
  label: string;
  keyUrl: string;
  keyPlaceholder: string;
  defaultModel: string;
  groups: Group[];
}

// Curated per provider. OpenRouter model ids are VERIFIED against the live catalogue + a real
// completion (openrouter.ai/models). NOTE: OpenRouter's $0 `:free` models are heavily rate-limited
// and often return empty/429 — deliberately not offered here; the low-cost ones are pennies + reliable.
const PROVIDERS: ProviderCfg[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-...",
    defaultModel: "openai/gpt-4o-mini",
    groups: [
      {
        title: "Cheapest · ~$0.02 / M tokens",
        models: [
          { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
          { id: "mistralai/mistral-nemo", label: "Mistral Nemo" },
        ],
      },
      {
        title: "Low cost · pennies, reliable",
        models: [
          { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
          { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
          { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
          { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        ],
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-4o-mini",
    groups: [
      { title: "Low cost", models: [{ id: "gpt-4o-mini", label: "GPT-4o mini" }] },
      {
        title: "Premium",
        models: [
          { id: "gpt-4o", label: "GPT-4o" },
          { id: "o3-mini", label: "o3-mini (reasoning)" },
        ],
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-3-5-haiku-latest",
    groups: [
      { title: "Low cost", models: [{ id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" }] },
      {
        title: "Premium",
        models: [{ id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" }],
      },
    ],
  },
];

const DEFAULT_PROVIDER: ProviderCfg = PROVIDERS.find((p) => p.id === "openrouter") ?? {
  id: "openrouter",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/keys",
  keyPlaceholder: "sk-or-...",
  defaultModel: "openai/gpt-4o-mini",
  groups: [],
};
const providerOf = (id: string): ProviderCfg =>
  PROVIDERS.find((p) => p.id === id) ?? DEFAULT_PROVIDER;

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * BYO-LLM: point Ask AI at your own model (docs/10 §3). Pick a provider — OpenRouter (one key,
 * any model incl. free), OpenAI, or Anthropic — paste that provider's key + pick a model. On save
 * we run a live test call and only store on success. The key is encrypted server-side and never
 * shown again. Admin-only. Without this, Ask AI uses the platform default.
 */
export function LlmSettingsCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: LlmSettings | null;
}) {
  const [current, setCurrent] = React.useState<LlmSettings | null>(initial);
  const [provider, setProvider] = React.useState<string>(initial?.provider ?? "openrouter");
  const [model, setModel] = React.useState(initial?.model ?? providerOf(provider).defaultModel);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const pcfg = providerOf(provider);
  const knownIds = pcfg.groups.flatMap((g) => g.models.map((m) => m.id));

  function switchProvider(id: string) {
    setProvider(id);
    setModel(providerOf(id).defaultModel);
    setMsg(null);
  }

  async function save() {
    if (!model.trim() || !apiKey.trim()) {
      setMsg({ tone: "warn", text: `Enter a model and your ${pcfg.label} API key.` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const saved = await setLlmSettings(orgId, provider, model.trim(), apiKey.trim());
      setCurrent(saved);
      setApiKey("");
      setMsg({ tone: "ok", text: `Tested + saved - Ask AI now uses ${saved.model}.` });
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
          <AtlasAiMark size={18} className="size-[18px]" />
          Ask AI model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Bring your own model for Ask AI. Answers stay grounded in your graph and cited - the model
          only narrates. Your key is tested, stored encrypted, and never shown again.
        </p>

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          {current ? (
            <span className="inline-flex items-center gap-1.5">
              Currently using <span className="font-medium">{current.model}</span> via
              <ProviderIcon id={current.provider} className="size-3.5" />
              {providerOf(current.provider).label}.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Using the platform default. Add a key below to use your own model.
            </span>
          )}
        </div>

        {/* Provider selector with brand icons. */}
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => switchProvider(p.id)}
              aria-pressed={provider === p.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
                provider === p.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ProviderIcon id={p.id} className="size-3.5" />
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {pcfg.label} API key
              <a
                href={pcfg.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
              >
                get one <ExternalLink className="size-3" />
              </a>
            </span>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current ? "•••••••• (enter to replace)" : pcfg.keyPlaceholder}
              autoComplete="off"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
              className={SELECT_CLASS}
            >
              {/* Preserve a saved/custom model that isn't in the curated list. */}
              {!knownIds.includes(model) ? <option value={model}>{model}</option> : null}
              {pcfg.groups.map((g) => (
                <optgroup key={g.title} label={g.title}>
                  {g.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => void save()} disabled={busy} size="sm">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testing…
              </>
            ) : current ? (
              "Update model"
            ) : (
              "Test & save"
            )}
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
