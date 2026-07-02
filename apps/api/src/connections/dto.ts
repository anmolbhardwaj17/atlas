import { z } from "zod";
import type { ConnectionStatus, ConnectionProvider } from "@atlas/db";

/** Request schemas (docs/08 §8). `.strict()` rejects unknown fields (P8). */
export const CreateConnectionSchema = z
  .object({
    provider: z.enum(["aws", "github", "azure", "gcp", "bitbucket", "gitlab", "datadog"]),
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

/** Response DTO — secrets are NEVER present (docs/08 §4 DD-2; secret_ref is internal). */
export interface ConnectionDto {
  id: string;
  provider: ConnectionProvider;
  displayName: string;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  health: Record<string, unknown>;
  secretConfigured: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

/** Response for a manual sync trigger (POST /connections/:id/sync). */
export interface SyncTriggerDto {
  /** `queued` = a fresh run was enqueued; `already_running` = a run was already in flight. */
  status: "queued" | "already_running";
  runId: string | null;
}
