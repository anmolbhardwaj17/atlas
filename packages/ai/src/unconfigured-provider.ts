/**
 * The provider installed in PRODUCTION when Atlas has no platform LLM key (an explicit
 * `ALLOW_BYO_ONLY_LLM=true` deployment). It exists so that "no key" degrades LOUDLY.
 *
 * Why not just keep the MockLLMProvider there: the mock streams plausible-looking prose
 * ("(Atlas dev) Narration requires ANTHROPIC_API_KEY…") into the answer surface, which reads to a
 * user like a real — if broken — answer. That is precisely the fabrication mode the trust rules
 * forbid (P4/`docs/10` §7: "I don't know" is a designed state, a fake answer never is). Throwing
 * surfaces a real error the operator can see and act on.
 *
 * It keeps `name = "mock"` deliberately: the engine's existing `llm.name === "mock"` guards
 * (autoDiagnose bailing to a plain alert, suggestEdges refusing with an actionable message) are
 * exactly the right behaviour here too, and they never reach `complete()`.
 */
import type { CompleteRequest, LLMEvent, LLMProvider } from "./llm";

export class UnconfiguredLLMProvider implements LLMProvider {
  /** Same identity as the mock so every "needs a real model" guard short-circuits first. */
  readonly name = "mock";

  async *complete(_req: CompleteRequest): AsyncIterable<LLMEvent> {
    throw new Error(
      "No LLM is configured for this organization. Atlas is running without a platform model key " +
        "(ALLOW_BYO_ONLY_LLM), so each org must add its own key in Settings → AI.",
    );
    yield { type: "stop", reason: "unconfigured" }; // unreachable; keeps the generator well-typed
  }
}
