import { z } from "zod";
import type { ConnectionStatus, ConnectionProvider } from "@atlas/db";

/** Request schemas (docs/08 §8). `.strict()` rejects unknown fields (P8). */
export const CreateConnectionSchema = z
  .object({
    provider: z.enum([
      "aws",
      "github",
      "azure",
      "gcp",
      "bitbucket",
      "gitlab",
      "datadog",
      "jenkins",
      "jira",
    ]),
    displayName: z.string().trim().min(1).max(120),
    config: z.record(z.unknown()).optional(),
  })
  .strict();
export type CreateConnectionBody = z.infer<typeof CreateConnectionSchema>;

// Credentials are stored via the Secrets Broker (never persisted on the connection
// row, BR-CONN-1). e.g. { roleArn: "arn:aws:iam::…" } for AWS verify.
export const VerifyConnectionSchema = z
  .object({ credentials: z.record(z.string()).optional() })
  .strict();
export type VerifyConnectionBody = z.infer<typeof VerifyConnectionSchema>;

/** Outcome of the most recent finished sync run (FR-1.5). `partial` means some scopes
 *  were skipped (usually denied permission probes) — never presented as a full success (P3). */
export interface LastSyncDto {
  status: "succeeded" | "partial" | "failed" | "cancelled";
  finishedAt: string;
  /** Resources persisted into the graph by that run. */
  resources: number;
  edges: number;
  /** Scopes (service/region pairs) that failed - e.g. denied permission probes. */
  scopesFailed: number;
  /** The specific scope keys that were skipped (so the UI can say *what*, not just how many). */
  skippedScopes: string[];
}

/**
 * Live counters for a run that is still in flight (FR-1.5). Present only while `syncing` is true;
 * `null` otherwise. These are republished by the runner on each heartbeat and at every scope
 * boundary, so they grow monotonically within a run and reset when the next one starts — they are
 * progress, never a total. A queued-but-not-started run reports all zeros, which is the honest
 * answer ("nothing found yet"), not a claim that the estate is empty.
 */
export interface SyncProgressDto {
  /** Resource refs the connector has walked — runs ahead of `resources` (discover precedes persist). */
  discovered: number;
  /** Resources committed to the graph so far. */
  resources: number;
  edges: number;
  /** Scopes (service/region pairs) finished so far. */
  scopesOk: number;
}

/** Response DTO - secrets are NEVER present (docs/08 §4 DD-2; secret_ref is internal). */
export interface ConnectionDto {
  id: string;
  provider: ConnectionProvider;
  displayName: string;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  health: Record<string, unknown>;
  secretConfigured: boolean;
  /** Sample/demo connection (from the demo seed) — not a real syncable source. */
  demo: boolean;
  lastSyncedAt: string | null;
  /** A sync run is queued/running right now (one in flight max, BR-SYNC-1). */
  syncing: boolean;
  /** Live counters for that in-flight run; null when nothing is running. */
  syncProgress: SyncProgressDto | null;
  /** Most recent finished run, or null if none has completed yet. */
  lastSync: LastSyncDto | null;
  createdAt: string;
}

/** Response for a manual sync trigger (POST /connections/:id/sync). */
export interface SyncTriggerDto {
  /** `queued` = a fresh run was enqueued; `already_running` = a run was already in flight. */
  status: "queued" | "already_running";
  runId: string | null;
}
