import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { ConnectorLogger } from "@atlas/connector-sdk";
import { seedDemoData, DEMO_CONNECTION_NAME, type DemoSeedResult } from "@atlas/ingest";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";

/**
 * Demo data (P1.2, docs/09 §8). Backs the onboarding "Load sample data" button so a new
 * org reaches a populated, explorable, AI-answerable graph in seconds - TTFI < 30 min
 * without any cloud credentials (NFR-22). Seeds the "Shopyard" estate via the REAL
 * pipeline (`@atlas/ingest` `seedDemoData` → MockConnector → runStagedSync → runInference),
 * so it exercises the same code paths a live sync would and stays constraint-correct.
 *
 * Gated: only for organizations with no real connected source (empty or demo-only), so it
 * can never pollute a customer's real estate. Idempotent by URN (re-seeding is a no-op-ish
 * upsert). Admin-only at the controller (RolesGuard).
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async seed(orgId: string): Promise<DemoSeedResult> {
    // Guard: refuse if a real (non-demo) source is connected - sample data is for empty orgs.
    // Demo connections are the legacy single name or the per-provider "… (demo)" connections.
    const realSources = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM connections
         WHERE deleted_at IS NULL AND display_name <> $1 AND display_name NOT LIKE '%(demo)'`,
        [DEMO_CONNECTION_NAME],
      );
      return rows[0]?.n ?? 0;
    });
    if (realSources > 0) {
      throw ApiException.alreadyExists(
        "This organization already has a connected source. Sample data can only be loaded into an empty organization.",
      );
    }

    this.logger.log(`Seeding demo data for org ${orgId}`);
    const result = await seedDemoData({ db: this.db, logger: this.bridgeLogger() }, orgId);
    this.logger.log(
      `Demo seed complete for org ${orgId}: ${result.nodeCount} nodes, ` +
        `${result.observedEdges}+${result.inferredEdges} edges (${result.status}).`,
    );
    return result;
  }

  /** Bridge the connector-SDK logger onto the Nest logger for sync/inference visibility. */
  private bridgeLogger(): ConnectorLogger {
    const l = this.logger;
    return {
      debug: (m) => l.debug(m),
      info: (m) => l.log(m),
      warn: (m) => l.warn(m),
      error: (m) => l.error(m),
    };
  }
}
