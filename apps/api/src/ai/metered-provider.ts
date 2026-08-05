import type { CompleteRequest, LLMEvent, LLMProvider } from "@atlas/ai";
import type { AiUsageService } from "./ai-usage.service";

/**
 * Wraps an LLMProvider so every model call is budget-checked before it runs and metered after
 * (deploy-readiness audit, P1).
 *
 * Why a decorator at the `resolveProvider` boundary rather than per-call-site: there are six places
 * that resolve a provider and run the engine (`ask`, `diagnose`, `suggestEdges`, `coverageForPr`,
 * `autoDiagnose`, `answerForIntegration`), and the agentic loop calls `complete()` repeatedly within
 * one of those. Metering at each call site would mean six edits, an undercount of multi-hop loops,
 * and a standing invitation to forget the seventh. Wrapping once means every path — including any
 * added later — is covered, and each hop of a retrieval loop is counted individually.
 *
 * `name` is forwarded verbatim: the engine keys real behaviour off `llm.name === "mock"`
 * (autoDiagnose bails, suggestEdges refuses with an actionable error), and a wrapper that changed it
 * would silently switch those guards off.
 */
export class MeteredLLMProvider implements LLMProvider {
  readonly name: string;
  // Optional, not `string | undefined`: exactOptionalPropertyTypes treats those as different, and
  // the interface declares it optional. Assigned only when the wrapped provider actually has one.
  readonly model?: string;

  constructor(
    private readonly inner: LLMProvider,
    private readonly usage: AiUsageService,
    private readonly orgId: string,
    private readonly sharedKey: boolean,
  ) {
    this.name = inner.name;
    if (inner.model !== undefined) this.model = inner.model;
  }

  async *complete(req: CompleteRequest): AsyncIterable<LLMEvent> {
    // Before the spend, not after: refusing is only meaningful while the money is unspent. Throws
    // 429 when the org is over its monthly cap on Atlas's shared key.
    await this.usage.enforceBudget(this.orgId, this.sharedKey);

    for await (const event of this.inner.complete(req)) {
      if (event.type === "stop") {
        // Fire-and-forget, deliberately: `record` swallows its own errors, and awaiting a DB
        // round-trip here would add latency to the tail of every streamed answer. Recording before
        // the yield (not after) means it still happens when the consumer stops reading at `stop` —
        // code after a generator's final yield only runs if someone asks for another value.
        void this.usage.record(
          this.orgId,
          this.model ?? this.inner.name,
          this.sharedKey,
          event.usage,
        );
      }
      yield event;
    }
  }

  embed(texts: string[]): Promise<number[][]> {
    // Embeddings are not metered: nothing in Atlas calls this on a billed provider today (search is
    // Postgres FTS). Forwarded so the decorator stays a faithful stand-in for the wrapped provider.
    if (!this.inner.embed)
      return Promise.reject(new Error(`${this.name} does not support embed()`));
    return this.inner.embed(texts);
  }
}
