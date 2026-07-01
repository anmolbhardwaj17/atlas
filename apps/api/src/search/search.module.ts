import { Module, type Provider } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SearchController } from "./search.controller";
import { SEARCH_PROVIDER } from "./search.provider";
import { PostgresSearchProvider } from "./postgres-search.provider";

/**
 * Search (docs/11). The provider is bound behind SEARCH_PROVIDER so the OpenSearch driver
 * can replace the Postgres one at deploy with no controller/consumer change.
 */
const searchProvider: Provider = {
  provide: SEARCH_PROVIDER,
  useClass: PostgresSearchProvider,
};

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [searchProvider],
})
export class SearchModule {}
