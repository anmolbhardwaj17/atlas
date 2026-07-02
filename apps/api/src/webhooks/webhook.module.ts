import { Module, type Provider } from "@nestjs/common";
import { InMemoryQueue } from "@atlas/ingest";
import { JOB_QUEUE } from "../connections/tokens";
import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

/**
 * GitHub webhook ingress (docs/07 §5). ENV + PG_POOL come from the @Global CoreModule.
 * The JobQueue is the in-memory dev impl (F2.5) — the API only enqueues; a worker process
 * drains it in deploy (docs/02 §5). No AuthModule: the endpoint is HMAC-authenticated.
 */
const jobQueueProvider: Provider = {
  provide: JOB_QUEUE,
  useFactory: (): InMemoryQueue => new InMemoryQueue(),
};

@Module({
  controllers: [WebhookController],
  providers: [WebhookService, jobQueueProvider],
})
export class WebhookModule {}
