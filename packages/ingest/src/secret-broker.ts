import { randomUUID } from "node:crypto";
import type { SecretAccessor } from "@atlas/connector-sdk";

/**
 * Secrets Broker (docs/13 §7). Stores connector credentials out of band and hands
 * back an opaque `secret_ref` (BR-CONN-1: `connections.secret_ref` is a pointer,
 * never the secret). Connectors read material at call time via `get` (it extends the
 * SDK's SecretAccessor). The production impl is AWS Secrets Manager (Phase-later);
 * this in-memory broker is for dev/tests.
 */
export interface SecretBroker extends SecretAccessor {
  /** Store credential material; returns the opaque secret_ref to persist on the connection. */
  put(orgId: string, material: Record<string, string>): Promise<string>;
  delete(secretRef: string): Promise<void>;
}

export class InMemorySecretBroker implements SecretBroker {
  private readonly store = new Map<string, Record<string, string>>();

  async put(orgId: string, material: Record<string, string>): Promise<string> {
    const ref = `mem:${orgId}:${randomUUID()}`;
    this.store.set(ref, material);
    return ref;
  }

  async get(secretRef: string): Promise<Record<string, string>> {
    return this.store.get(secretRef) ?? {};
  }

  async delete(secretRef: string): Promise<void> {
    this.store.delete(secretRef);
  }
}
