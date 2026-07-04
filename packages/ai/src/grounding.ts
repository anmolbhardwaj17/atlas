/**
 * The Grounding Gate (docs/10 §4.5, DD-4, L1). A DETERMINISTIC decision — not the LLM's
 * judgment — on whether there's enough grounded context to answer, made BEFORE narration.
 * This stops the classic failure where a model handed thin context "fills the gap" with
 * plausible fiction (R3). On insufficient grounding it yields a structured honest-absence
 * reason (US-11) — a refusal is a SUCCESS here, not a failure (P3).
 *
 * Note: a resolved entity with an EMPTY traversal is still grounded — "nothing depends on
 * X" is a valid, truthful answer. The gate fails only on out-of-scope or unresolved entity.
 */
import type { RetrievalResult } from "./retrieval";

export interface Grounding {
  grounded: boolean;
  reason?: string;
}

export function groundingGate(result: RetrievalResult): Grounding {
  if (result.intent === "out_of_scope") {
    return {
      grounded: false,
      reason:
        "That's outside the connected graph Atlas indexes (I only answer from your synced infrastructure and code).",
    };
  }

  // Timeline ran its window query — even an empty window ("nothing changed") is grounded.
  if (result.intent === "timeline") return { grounded: true };

  // Estate answers from the whole-org snapshot; grounded as long as the snapshot loaded (even a
  // near-empty estate is a truthful "you have almost nothing connected yet" answer).
  if (result.intent === "estate") {
    return result.estate
      ? { grounded: true }
      : {
          grounded: false,
          reason: "I couldn't load your estate overview — the graph may still be syncing.",
        };
  }

  if (!result.rootNode) {
    const what = result.mention ? `"${result.mention}"` : "that";
    return {
      grounded: false,
      reason: `I couldn't find ${what} in the synced graph — it may not be connected, may be outside a scanned scope, or may not exist.`,
    };
  }
  return { grounded: true };
}
