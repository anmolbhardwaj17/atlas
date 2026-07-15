"use client";

import * as React from "react";
import { toast } from "sonner";
import { ShieldCheck, Download, Loader2, Search, UserX, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDataExport, erasePerson, searchNodes, type SearchHit } from "@/lib/browser-api";
import { cn } from "@/lib/cn";

/**
 * Privacy & data (Admin) — the DSAR admin surface. Export the personal data Atlas holds for the org
 * (right of access), and erase a specific person (right to be forgotten). Erasure redacts the
 * person's identity + scrubs their name from author/assignee/reporter fields, durably (re-applied
 * after each sync). Admin-only, mirrors what the API enforces.
 */
export function PrivacyDataCard({ orgId }: { orgId: string }) {
  const [exporting, setExporting] = React.useState(false);

  async function download() {
    if (exporting) return;
    setExporting(true);
    const data = await getDataExport(orgId);
    setExporting(false);
    if (!data) {
      toast.error("Couldn't generate the export.");
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-personal-data-${data.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(
      `Exported ${data.members.length} member(s) + ${data.identities.length} identit${data.identities.length === 1 ? "y" : "ies"}.`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" /> Privacy & data
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Answer data-subject requests: export the personal data we hold for this workspace, or
          erase a specific person from the graph.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Export personal data</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Members + every ingested contributor identity, as JSON (right of access).
            </div>
          </div>
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => void download()}>
            {exporting ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 size-3.5" />
            )}
            Export
          </Button>
        </div>

        <ErasePerson orgId={orgId} />
      </CardContent>
    </Card>
  );
}

/** Search a person (contributor identity) and erase them, with a confirm step (it's not reversible). */
function ErasePerson({ orgId }: { orgId: string }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [target, setTarget] = React.useState<{ id: string; name: string | null } | null>(null);
  const [erasing, setErasing] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      void searchNodes(orgId, q, ac.signal)
        // Only person/contributor identities are erasable (the API refuses anything else).
        .then((hits) => setResults(hits.filter((h) => /\.user$/.test(h.node.kind)).slice(0, 8)))
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, orgId]);

  async function confirmErase() {
    if (!target || erasing) return;
    setErasing(true);
    try {
      const n = await erasePerson(orgId, target.id);
      toast.success(`Erased — redacted ${n} record${n === 1 ? "" : "s"}.`);
      setTarget(null);
      setQuery("");
      setResults([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't erase this person.");
    } finally {
      setErasing(false);
    }
  }

  return (
    <div className="rounded-lg border border-border px-3.5 py-3">
      <div className="text-sm font-medium">Erase a person</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        Redacts their identity and scrubs their name from authorship across the graph — and keeps it
        scrubbed after future syncs. This can&rsquo;t be undone.
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setTarget(null);
          }}
          placeholder="Search a contributor by name or login…"
          className="pl-8"
        />
      </div>

      {results.length > 0 && !target ? (
        <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
          {results.map((h) => (
            <button
              key={h.node.id}
              type="button"
              onClick={() => setTarget({ id: h.node.id, name: h.node.name })}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {h.node.name ?? <span className="text-muted-foreground">unnamed</span>}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {h.node.kind.replace(/\.user$/, "")}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {target ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5">
          <span className="min-w-0 text-xs">
            Erase <span className="font-medium">{target.name ?? "this person"}</span>? This is
            permanent.
          </span>
          <span className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={erasing}
              onClick={() => setTarget(null)}
              className="h-7"
            >
              <X className="size-3.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={erasing}
              onClick={() => void confirmErase()}
              className={cn("h-7 bg-danger text-white hover:bg-danger/90")}
            >
              {erasing ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <UserX className="mr-1.5 size-3.5" />
              )}
              Erase
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
