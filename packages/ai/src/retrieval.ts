/**
 * Retrieval orchestration (docs/10 §4.3). Executes a RetrievalPlan against the (bounded,
 * org-scoped) RetrievalPort - deterministic graph traversals are the primary source
 * (AE-4). The result feeds the context builder + grounding gate. Nothing here calls the
 * LLM; retrieval happens BEFORE narration (retrieval-first pipeline).
 */
import type { RetrievalPlan } from "./planner";
import type {
  EstateOverview,
  RetrievalPort,
  RetrievedEdge,
  RetrievedNode,
  Traversal,
  TimelineChange,
} from "./retrieval-port";

export interface RetrievalResult {
  intent: RetrievalPlan["intent"];
  mention: string | null;
  /** True when >1 candidate resolved (the narrator should disambiguate, P3). */
  ambiguous: boolean;
  rootNode?: RetrievedNode;
  traversal?: Traversal;
  edges?: RetrievedEdge[];
  timeline?: TimelineChange[];
  /** Whole-org aggregate snapshot for `estate` intent (P0 estate slice). */
  estate?: EstateOverview;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function orchestrate(
  port: RetrievalPort,
  orgId: string,
  plan: RetrievalPlan,
): Promise<RetrievalResult> {
  const candidates = plan.entity?.candidates ?? [];
  const result: RetrievalResult = {
    intent: plan.intent,
    mention: plan.entity?.mention ?? null,
    ambiguous: candidates.length > 1,
  };

  if (plan.intent === "out_of_scope") return result;

  if (plan.intent === "timeline") {
    result.timeline = await port.timeline(orgId, isoDaysAgo(plan.window?.sinceDays ?? 7), null, 50);
    return result;
  }

  if (plan.intent === "estate") {
    result.estate = await port.estateOverview(orgId);
    return result;
  }

  const top = candidates[0];
  if (!top) return result; // unresolved entity → grounding gate emits honest-absence

  const node = await port.getNode(orgId, top.id);
  if (node) result.rootNode = node;

  switch (plan.intent) {
    case "blast_radius":
    case "dependents":
      // "what breaks if X" / "what depends on X" - inbound impact closure (docs/05 §7.2).
      result.traversal = await port.blastRadius(orgId, top.id, {});
      break;
    case "deploy_mapping":
      result.edges = (await port.edges(orgId, top.id, "in")).filter((e) => e.type === "DEPLOYS_TO");
      break;
    case "culprit":
      result.edges = (await port.edges(orgId, top.id, "in")).filter((e) => e.type === "CHANGED_BY");
      result.timeline = await port.timeline(
        orgId,
        isoDaysAgo(plan.window?.sinceDays ?? 7),
        null,
        50,
      );
      break;
    case "architecture":
    case "lookup":
    default:
      result.edges = await port.edges(orgId, top.id, "both");
  }
  return result;
}
