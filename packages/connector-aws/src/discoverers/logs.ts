/** CloudWatch Log Groups discoverer (read-only DescribeLogGroups) - the raw material of
 *  the log-intelligence layer (services/logs.ts). */
import { CloudWatchLogsClient, paginateDescribeLogGroups } from "@aws-sdk/client-cloudwatch-logs";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

export const logsDiscoverer: Discoverer = {
  service: "logs",
  scope: "region",
  kind: "aws.logs.group",
  iamAction: "logs:DescribeLogGroups",
  async *crawl(input) {
    const client = new CloudWatchLogsClient(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeLogGroups({ client }, {})) {
      for (const lg of page.logGroups ?? []) {
        if (lg.logGroupName) yield emit(this, input, lg.logGroupName, lg);
      }
    }
  },
};
