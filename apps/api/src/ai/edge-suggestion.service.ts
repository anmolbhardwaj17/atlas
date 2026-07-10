import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { EdgeMatcherInput, EdgeSuggestion, RepoCandidate, RuntimeCandidate } from "@atlas/ai";
import { PG_POOL } from "../core/tokens";

/** Compute runtimes a repo can DEPLOYS_TO, and the repo kinds we match from. */
const RUNTIME_KINDS = ["aws.lambda.function", "aws.ecs.service", "aws.ec2.instance"];
const REPO_KINDS = ["bitbucket.repository", "github.repository"];
// Bound the model prompt (cost + context). Enough for a real estate; excess is logged.
const RUNTIME_CAP = 60;
const REPO_CAP = 80;

interface NodeRow {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  tags: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

export interface GatheredContext {
  input: EdgeMatcherInput;
  /** urn → node id, for resolving the model's proposals back to rows. */
  idByUrn: Map<string, string>;
  /** `${fromId}→${toId}→${type}` the user already rejected — never re-propose. */
  rejected: Set<string>;
  /** How many unmatched runtimes exist beyond the cap (for honest reporting). */
  runtimesOverCap: number;
}

/**
 * DB side of AI edge suggestions (docs/05 §6, docs/10). Gathers the context the matcher reasons
 * over — runtimes with NO code link + candidate repos + prior rejections — and writes the model's
 * accepted proposals as `origin='ai_suggested'` edges (a distinct, lowest-trust state the user
 * confirms/rejects; never touched by the deterministic retire pass). The LLM call itself lives in
 * AiService (which owns provider resolution); this service is pure DB + org-scoped (R8).
 */
@Injectable()
export class EdgeSuggestionService {
  private readonly logger = new Logger(EdgeSuggestionService.name);

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /** Runtimes with no active DEPLOYS_TO link + all repos + prior rejections. */
  async gather(orgId: string): Promise<GatheredContext> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows: runtimeRows } = await c.query<NodeRow>(
        `SELECT id, urn, kind, name, tags, attributes FROM nodes n
          WHERE kind = ANY($1) AND status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM edges e
               WHERE e.to_node_id = n.id AND e.type = 'DEPLOYS_TO' AND e.status = 'active'
            )
          ORDER BY name NULLS LAST
          LIMIT $2 + 1`,
        [RUNTIME_KINDS, RUNTIME_CAP],
      );
      const runtimesOverCap = Math.max(0, runtimeRows.length - RUNTIME_CAP);
      const runtimeCapped = runtimeRows.slice(0, RUNTIME_CAP);

      const { rows: repoRows } = await c.query<NodeRow>(
        `SELECT id, urn, kind, name, tags, attributes FROM nodes
          WHERE kind = ANY($1) AND status = 'active' ORDER BY name NULLS LAST LIMIT $2`,
        [REPO_KINDS, REPO_CAP],
      );

      const { rows: rejRows } = await c.query<{
        from_node_id: string;
        to_node_id: string;
        type: string;
      }>(`SELECT from_node_id, to_node_id, type FROM edge_suggestion_rejections`);

      const idByUrn = new Map<string, string>();
      for (const r of [...runtimeCapped, ...repoRows]) idByUrn.set(r.urn, r.id);
      const rejected = new Set(rejRows.map((r) => `${r.from_node_id}→${r.to_node_id}→${r.type}`));

      const runtimes: RuntimeCandidate[] = runtimeCapped.map((r) => ({
        urn: r.urn,
        kind: r.kind,
        name: r.name ?? r.urn.split("/").pop() ?? r.urn,
        facts: factsFromTags(r.tags),
      }));
      const repos: RepoCandidate[] = repoRows.map((r) => ({
        urn: r.urn,
        slug: String(r.attributes.slug ?? r.urn.split("/").pop() ?? ""),
        language: strOrNull(r.attributes.language),
        description: strOrNull(r.attributes.description),
      }));

      return { input: { runtimes, repos }, idByUrn, rejected, runtimesOverCap };
    });
  }

  /** Persist the model's proposals as ai_suggested edges. Skips rejected pairs and any pair that
   *  already has an active DEPLOYS_TO edge. Returns how many edges were written. */
  async write(orgId: string, suggestions: EdgeSuggestion[], ctx: GatheredContext): Promise<number> {
    if (suggestions.length === 0) return 0;
    return withOrgScope(this.db, orgId, async (c) => {
      let written = 0;
      for (const s of suggestions) {
        const fromId = ctx.idByUrn.get(s.repoUrn);
        const toId = ctx.idByUrn.get(s.runtimeUrn);
        if (!fromId || !toId) continue;
        if (ctx.rejected.has(`${fromId}→${toId}→DEPLOYS_TO`)) continue;

        const exists = await c.query(
          `SELECT 1 FROM edges
            WHERE from_node_id = $1 AND to_node_id = $2 AND type = 'DEPLOYS_TO' AND status = 'active'
            LIMIT 1`,
          [fromId, toId],
        );
        if (exists.rowCount) continue;

        const prov = await c.query<{ id: string }>(
          `INSERT INTO provenance (org_id, source, confidence, evidence)
           VALUES ($1, 'ai:edge-matcher', 'ai-suggested', $2) RETURNING id`,
          [
            orgId,
            JSON.stringify({
              matcher: "edge-matcher",
              reasoning: s.reasoning,
              modelConfidence: s.confidence,
            }),
          ],
        );
        const provId = prov.rows[0]?.id;

        const ins = await c.query<{ id: string }>(
          `INSERT INTO edges
             (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen)
           VALUES ($1, $2, $3, 'DEPLOYS_TO', 'ai_suggested', 'ai-suggested', $4, now())
           ON CONFLICT ON CONSTRAINT uq_edge DO NOTHING
           RETURNING id`,
          [orgId, fromId, toId, provId],
        );
        if (ins.rowCount) written += 1;
      }
      return written;
    });
  }
}

function factsFromTags(tags: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags ?? {})) {
    if (typeof v === "string" && v && Object.keys(out).length < 6) out[k] = v.slice(0, 60);
  }
  return out;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
