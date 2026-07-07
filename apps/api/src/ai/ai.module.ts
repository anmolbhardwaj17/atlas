import { Module, type Provider } from "@nestjs/common";
import { ClaudeProvider, MockLLMProvider } from "@atlas/ai";
import { AuthModule } from "../auth/auth.module";
import { ConnectionsModule } from "../connections/connections.module";
import { GraphService } from "../graph/graph.service";
import { SEARCH_PROVIDER } from "../search/search.provider";
import { PostgresSearchProvider } from "../search/postgres-search.provider";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";
import { LLM_PROVIDER } from "./tokens";

/**
 * AI (docs/10). Wires the NestJS-free `@atlas/ai` engine: a RetrievalPort adapter over the
 * G2 read layer + an LLM provider (Claude when ANTHROPIC_API_KEY is set, else a dev mock -
 * so retrieval/grounding/citation still work in dev/CI without a key). GraphService +
 * search provider are provided locally (both are stateless over the global PG pool).
 */
const llmProvider: Provider = {
  provide: LLM_PROVIDER,
  useFactory: () =>
    process.env.ANTHROPIC_API_KEY
      ? new ClaudeProvider()
      : new MockLLMProvider(
          "(Atlas dev) Narration requires ANTHROPIC_API_KEY; the grounded context was retrieved.",
        ),
};

const searchProvider: Provider = {
  provide: SEARCH_PROVIDER,
  useClass: PostgresSearchProvider,
};

@Module({
  // ConnectionsModule exports SECRET_BROKER (for per-org BYO-LLM key resolution).
  imports: [AuthModule, ConnectionsModule],
  controllers: [AiController],
  providers: [GraphService, searchProvider, GraphRetrievalPort, AiService, llmProvider],
  // The autonomous-diagnosis agent (AiService.autoDiagnose) is used by the notifications
  // dispatcher to investigate breaks proactively.
  exports: [AiService],
})
export class AiModule {}
