/**
 * Route53 discoverer (global). Lists hosted zones then each zone's record sets; the
 * record's URN is <zone>/<name>/<type> and alias targets become routing signals
 * (docs/06 §4, docs/05 §6.4). ListResourceRecordSets paginates by record name/type
 * (not a NextToken), so we page manually.
 */
import {
  Route53Client,
  paginateListHostedZones,
  ListResourceRecordSetsCommand,
  type ListResourceRecordSetsCommandInput,
} from "@aws-sdk/client-route-53";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

/** Hosted-zone id comes as /hostedzone/Z123; keep the bare id for stable URNs. */
function zoneId(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.split("/").pop() ?? null;
}

export const route53Discoverer: Discoverer = {
  service: "route53",
  scope: "global",
  kind: "aws.route53.record",
  iamAction: "route53:ListResourceRecordSets",
  async *crawl(input) {
    const client = new Route53Client(clientConfig(input.credentials, input.region));
    for await (const zonePage of paginateListHostedZones({ client }, {})) {
      for (const zone of zonePage.HostedZones ?? []) {
        const hz = zoneId(zone.Id);
        if (!hz) continue;
        let startName: string | undefined;
        let startType: string | undefined;
        for (;;) {
          const cmdInput: ListResourceRecordSetsCommandInput = { HostedZoneId: hz };
          if (startName) cmdInput.StartRecordName = startName;
          if (startType) {
            cmdInput.StartRecordType =
              startType as ListResourceRecordSetsCommandInput["StartRecordType"];
          }
          const out = await client.send(new ListResourceRecordSetsCommand(cmdInput));
          for (const rr of out.ResourceRecordSets ?? []) {
            if (!rr.Name || !rr.Type) continue;
            yield emit(this, input, hz + "/" + rr.Name + "/" + rr.Type, {
              ...rr,
              HostedZoneId: hz,
            });
          }
          if (!out.IsTruncated) break;
          startName = out.NextRecordName;
          startType = out.NextRecordType;
        }
      }
    }
  },
};
