/**
 * ELB (ALB/NLB) discoverer. Enriches each load balancer with its target groups and
 * resolved targets (DescribeTargetGroups → DescribeTargetHealth) so the pure module can
 * emit ROUTES_TO(elb→instance) edges (docs/06 §4).
 */
import {
  ElasticLoadBalancingV2Client,
  paginateDescribeLoadBalancers,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

export const elbDiscoverer: Discoverer = {
  service: "elb",
  scope: "region",
  kind: "aws.elb",
  iamAction: "elasticloadbalancing:DescribeLoadBalancers",
  async *crawl(input) {
    const client = new ElasticLoadBalancingV2Client(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeLoadBalancers({ client }, {})) {
      for (const lb of page.LoadBalancers ?? []) {
        if (!lb.LoadBalancerArn || !lb.LoadBalancerName) continue;
        const TargetGroups: Array<{
          TargetGroupArn: string;
          TargetType: string | undefined;
          Targets: Array<{ Id: string | undefined; Port: number | undefined }>;
        }> = [];
        try {
          const tgOut = await client.send(
            new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn }),
          );
          for (const tg of tgOut.TargetGroups ?? []) {
            if (!tg.TargetGroupArn) continue;
            const health = await client.send(
              new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }),
            );
            TargetGroups.push({
              TargetGroupArn: tg.TargetGroupArn,
              TargetType: tg.TargetType,
              Targets: (health.TargetHealthDescriptions ?? []).map((t) => ({
                Id: t.Target?.Id,
                Port: t.Target?.Port,
              })),
            });
          }
        } catch {
          // One LB's target-group / health enrichment failed (a TG deleted mid-crawl, or a partial
          // permission on that resource). Don't abort the whole region's ELB scope — emit the LB
          // without its resolved targets; its ROUTES_TO edges are simply missing until the next sync
          // (P3: prefer a missing edge to losing every load balancer in the region).
        }
        yield emit(this, input, lb.LoadBalancerName, { ...lb, TargetGroups });
      }
    }
  },
};
