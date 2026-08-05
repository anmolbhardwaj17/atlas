import { Logger, Module, type Provider } from "@nestjs/common";
import { ClaudeProvider, MockLLMProvider, UnconfiguredLLMProvider } from "@atlas/ai";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";
import { AuthModule } from "../auth/auth.module";
import { ConnectionsModule } from "../connections/connections.module";
import { GraphService } from "../graph/graph.service";
import { SEARCH_PROVIDER } from "../search/search.provider";
import { PostgresSearchProvider } from "../search/postgres-search.provider";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { AiService } from "./ai.service";
import { AiUsageService } from "./ai-usage.service";
import { EdgeSuggestionService } from "./edge-suggestion.service";
import { AiController } from "./ai.controller";
import { IntentController } from "./intent.controller";
import { LLM_PROVIDER } from "./tokens";

/**
 * AI (docs/10). Wires the NestJS-free `@atlas/ai` engine: a RetrievalPort adapter over the
 * G2 read layer + an LLM provider (Claude when ANTHROPIC_API_KEY is set, else a dev mock -
 * so retrieval/grounding/citation still work in dev/CI without a key). GraphService +
 * search provider are provided locally (both are stateless over the global PG pool).
 */
const llmProvider: Provider = {
  provide: LLM_PROVIDER,
  inject: [ENV],
  // The key now comes from the VALIDATED config, not a raw process.env read — so a prod deploy that
  // forgets it fails at boot (see the ANTHROPIC_API_KEY check in @atlas/config) instead of silently
  // narrating from the dev mock. The dev mock stays the dev/CI default: retrieval, grounding and
  // citations are all exercisable without a key.
  useFactory: (env: Env) => {
    if (env.ANTHROPIC_API_KEY) return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    if (env.NODE_ENV === "production") {
      // Only reachable with an explicit ALLOW_BYO_ONLY_LLM=true. Fail loudly per org rather than
      // serving mock prose as an answer.
      Logger.warn(
        "No platform ANTHROPIC_API_KEY (ALLOW_BYO_ONLY_LLM). Orgs without a BYO key get an error, not an answer.",
        "AiModule",
      );
      return new UnconfiguredLLMProvider();
    }
    return new MockLLMProvider(
      "(Atlas dev) Narration requires ANTHROPIC_API_KEY; the grounded context was retrieved.",
    );
  },
};

const searchProvider: Provider = {
  provide: SEARCH_PROVIDER,
  useClass: PostgresSearchProvider,
};

@Module({
  // ConnectionsModule exports SECRET_BROKER (for per-org BYO-LLM key resolution).
  imports: [AuthModule, ConnectionsModule],
  controllers: [AiController, IntentController],
  providers: [
    GraphService,
    searchProvider,
    GraphRetrievalPort,
    AiService,
    AiUsageService,
    EdgeSuggestionService,
    llmProvider,
  ],
  // The autonomous-diagnosis agent (AiService.autoDiagnose) is used by the notifications
  // dispatcher to investigate breaks proactively.
  exports: [AiService],
})
export class AiModule {}
