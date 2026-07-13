"use client";

import * as React from "react";
import { Check, Copy, Network } from "lucide-react";
import { egressIps } from "@/lib/env";
import { cn } from "@/lib/cn";

/**
 * "Whitelist Atlas's IP" note in the connector setup. Enterprises commonly restrict inbound access
 * to an IP allowlist / firewall / security group (or keep the service on an internal network), so
 * Atlas — connecting from a fixed egress IP — must be allowed through or the sync silently can't
 * reach the target. Shows the IP(s) with a copy button; falls back to neutral guidance when the IP
 * isn't configured (NEXT_PUBLIC_ATLAS_EGRESS_IPS). Rendered once alongside the per-provider steps.
 */
const WHERE: Record<string, string> = {
  aws: "your IAM policies use IP conditions or restrict API access",
  github: "your GitHub Enterprise Server is behind a firewall",
  bitbucket: "your workspace enforces an IP allowlist",
  jira: "your Atlassian site enforces an IP allowlist",
  jenkins: "your Jenkins is on an internal network or behind a firewall",
  datadog: "your Datadog account restricts access by IP",
};

export function EgressIpNote({ providerId }: { providerId: string }) {
  const ips = egressIps();
  const [copied, setCopied] = React.useState(false);
  const where = WHERE[providerId] ?? "the service is behind a firewall or IP allowlist";

  const copy = React.useCallback(() => {
    void navigator.clipboard?.writeText(ips.join(", ")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [ips]);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Network className="size-4 shrink-0 text-muted-foreground" />
        Behind a firewall or private network?
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Atlas connects from {ips.length > 1 ? "these fixed IPs" : "a fixed IP"}. If {where}, add{" "}
        {ips.length > 1 ? "them" : "it"} to the allowlist so we can reach it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ips.length > 0 ? (
          <>
            {ips.map((ip) => (
              <code
                key={ip}
                className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs"
              >
                {ip}
              </code>
            ))}
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        ) : (
          <span className={cn("text-xs italic text-muted-foreground")}>
            Your Atlas admin can provide the exact IP to whitelist.
          </span>
        )}
      </div>
    </div>
  );
}
