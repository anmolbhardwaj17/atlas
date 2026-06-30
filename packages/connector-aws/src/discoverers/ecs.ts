/**
 * ECS discoverers: cluster, service, task definition. ECS uses list→describe (the list
 * returns only ARNs), and DescribeServices is capped at 10 ids/call, so we chunk.
 */
import {
  ECSClient,
  paginateListClusters,
  paginateListServices,
  paginateListTaskDefinitionFamilies,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const ecsClusterDiscoverer: Discoverer = {
  service: "ecs-cluster",
  scope: "region",
  kind: "aws.ecs.cluster",
  iamAction: "ecs:DescribeClusters",
  async *crawl(input) {
    const client = new ECSClient(clientConfig(input.credentials, input.region));
    const arns: string[] = [];
    for await (const page of paginateListClusters({ client }, {}))
      arns.push(...(page.clusterArns ?? []));
    for (const batch of chunk(arns, 100)) {
      const out = await client.send(new DescribeClustersCommand({ clusters: batch }));
      for (const cluster of out.clusters ?? []) {
        if (cluster.clusterName)
          yield emit(this, input, cluster.clusterArn ?? cluster.clusterName, cluster);
      }
    }
  },
};

export const ecsServiceDiscoverer: Discoverer = {
  service: "ecs-service",
  scope: "region",
  kind: "aws.ecs.service",
  iamAction: "ecs:DescribeServices",
  async *crawl(input) {
    const client = new ECSClient(clientConfig(input.credentials, input.region));
    const clusters: string[] = [];
    for await (const page of paginateListClusters({ client }, {}))
      clusters.push(...(page.clusterArns ?? []));
    for (const cluster of clusters) {
      const serviceArns: string[] = [];
      for await (const page of paginateListServices({ client }, { cluster })) {
        serviceArns.push(...(page.serviceArns ?? []));
      }
      for (const batch of chunk(serviceArns, 10)) {
        const out = await client.send(new DescribeServicesCommand({ cluster, services: batch }));
        for (const svc of out.services ?? []) {
          if (svc.serviceName) yield emit(this, input, svc.serviceArn ?? svc.serviceName, svc);
        }
      }
    }
  },
};

export const ecsTaskDefDiscoverer: Discoverer = {
  service: "ecs-taskdef",
  scope: "region",
  kind: "aws.ecs.taskdef",
  iamAction: "ecs:DescribeTaskDefinition",
  async *crawl(input) {
    const client = new ECSClient(clientConfig(input.credentials, input.region));
    const families: string[] = [];
    for await (const page of paginateListTaskDefinitionFamilies({ client }, { status: "ACTIVE" })) {
      families.push(...(page.families ?? []));
    }
    // MVP: index the latest active revision per family (docs/06 §14 edge case).
    for (const family of families) {
      const out = await client.send(new DescribeTaskDefinitionCommand({ taskDefinition: family }));
      const td = out.taskDefinition;
      if (td?.family) yield emit(this, input, family, td);
    }
  },
};
