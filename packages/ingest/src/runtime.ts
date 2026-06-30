import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";

/**
 * Dev/test runtime helpers for the connector context. The real Secrets Broker
 * (docs/13 §7) lands in F2.6; the queue-backed worker logger in F2.5.
 */

/** No-op secrets — for connectors that need none (e.g. the mock). */
export const nullSecretAccessor: SecretAccessor = {
  get: async () => ({}),
};

/** Dev secrets keyed in the environment as `ATLAS_SECRET_<ref>` = JSON object. */
export class EnvSecretAccessor implements SecretAccessor {
  async get(secretRef: string): Promise<Record<string, string>> {
    const raw = process.env[`ATLAS_SECRET_${secretRef}`];
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  }
}

export const silentLogger: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const consoleLogger: ConnectorLogger = {
  debug: (m, meta) => console.debug(`[ingest] ${m}`, meta ?? ""),
  info: (m, meta) => console.info(`[ingest] ${m}`, meta ?? ""),
  warn: (m, meta) => console.warn(`[ingest] ${m}`, meta ?? ""),
  error: (m, meta) => console.error(`[ingest] ${m}`, meta ?? ""),
};
