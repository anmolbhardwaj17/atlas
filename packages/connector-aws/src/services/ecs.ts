/**
 * ECS + ECR service modules (docs/06 §4).
 * - ECS service emits CONTAINS(cluster→service) (docs/05 §4.1).
 * - ECS task definition emits USES_IMAGE(taskdef→ecr) per ECR image and
 *   ASSUMES_ROLE(taskdef→role) for the task & execution roles.
 * - ECR repository is a node (the target of USES_IMAGE).
 * Note: ECS/ECR describe payloads use camelCase keys (unlike EC2's PascalCase).
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed, roleUrnFromArn, parseEcrImage } from "./helpers";

interface EcsCluster {
  clusterName: string;
  clusterArn?: string;
  status?: string;
}

export const ecsClusterModule: ServiceModule<EcsCluster> = {
  kind: "aws.ecs.cluster",
  service: "ecs-cluster",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.ecs.cluster", { account, region, naturalKey: data.clusterName }),
      kind: "aws.ecs.cluster",
      displayName: data.clusterName,
      attributes: {
        region,
        accountRef: account,
        clusterName: data.clusterName,
        status: data.status,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};

interface EcsService {
  serviceName: string;
  clusterArn?: string;
  taskDefinition?: string;
  desiredCount?: number;
  loadBalancers?: Array<{
    targetGroupArn?: string;
    containerName?: string;
    containerPort?: number;
  }>;
}

/** Cluster name is the last `/` segment of a cluster ARN (`…:cluster/<name>`). */
function clusterNameFromArn(arn: string | undefined): string | null {
  if (!arn) return null;
  return arn.split("/").pop() ?? null;
}

export const ecsServiceModule: ServiceModule<EcsService> = {
  kind: "aws.ecs.service",
  service: "ecs-service",
  scope: "region",
  normalize({ account, region, data }) {
    const cluster = clusterNameFromArn(data.clusterArn) ?? "unknown";
    return {
      urn: awsUrn("aws.ecs.service", {
        account,
        region,
        naturalKey: `${cluster}/${data.serviceName}`,
      }),
      kind: "aws.ecs.service",
      displayName: data.serviceName,
      attributes: {
        region,
        accountRef: account,
        serviceName: data.serviceName,
        cluster,
        taskDefinition: data.taskDefinition,
        desiredCount: data.desiredCount,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const cluster = clusterNameFromArn(data.clusterArn);
    if (!cluster) return [];
    const clusterUrn = awsUrn("aws.ecs.cluster", { account, region, naturalKey: cluster });
    const self = awsUrn("aws.ecs.service", {
      account,
      region,
      naturalKey: `${cluster}/${data.serviceName}`,
    });
    return [observed("CONTAINS", clusterUrn, self)];
  },
  extractSignals({ account, region, data }) {
    const cluster = clusterNameFromArn(data.clusterArn) ?? "unknown";
    const subjectUrn = awsUrn("aws.ecs.service", {
      account,
      region,
      naturalKey: `${cluster}/${data.serviceName}`,
    });
    const tgs = (data.loadBalancers ?? []).map((lb) => lb.targetGroupArn).filter(Boolean);
    if (tgs.length === 0) return [];
    // Target-group links feed ALB→service ROUTES_TO inference (docs/05 §6.4).
    return [{ kind: "aws.ecs.targetgroups", subjectUrn, data: { targetGroupArns: tgs } }];
  },
};

interface EcsTaskDef {
  family: string;
  taskDefinitionArn?: string;
  taskRoleArn?: string;
  executionRoleArn?: string;
  revision?: number;
  containerDefinitions?: Array<{
    name?: string;
    image?: string;
    environment?: Array<{ name?: string; value?: string }>;
  }>;
}

export const ecsTaskDefModule: ServiceModule<EcsTaskDef> = {
  kind: "aws.ecs.taskdef",
  service: "ecs-taskdef",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.ecs.taskdef", { account, region, naturalKey: data.family }),
      kind: "aws.ecs.taskdef",
      displayName: data.family,
      attributes: {
        region,
        accountRef: account,
        family: data.family,
        revision: data.revision,
        taskRoleArn: data.taskRoleArn,
        executionRoleArn: data.executionRoleArn,
        images: (data.containerDefinitions ?? []).map((c) => c.image).filter(Boolean),
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.ecs.taskdef", { account, region, naturalKey: data.family });
    const edges = [];
    for (const arn of [data.taskRoleArn, data.executionRoleArn]) {
      const roleUrn = arn ? roleUrnFromArn(arn) : null;
      if (roleUrn) edges.push(observed("ASSUMES_ROLE", self, roleUrn));
    }
    for (const c of data.containerDefinitions ?? []) {
      const img = c.image ? parseEcrImage(c.image) : null;
      if (img) {
        const ecrUrn = awsUrn("aws.ecr.repository", {
          account: img.account,
          region: img.region,
          naturalKey: img.repository,
        });
        edges.push(observed("USES_IMAGE", self, ecrUrn, { tag: img.tag }));
      }
    }
    return edges;
  },
  extractSignals({ account, region, data }) {
    const subjectUrn = awsUrn("aws.ecs.taskdef", { account, region, naturalKey: data.family });
    const env: Record<string, string> = {};
    for (const c of data.containerDefinitions ?? []) {
      for (const e of c.environment ?? []) {
        if (e.name != null) env[e.name] = e.value ?? "";
      }
    }
    if (Object.keys(env).length === 0) return [];
    return [{ kind: "aws.ecs.env", subjectUrn, data: { variables: env } }];
  },
};

interface EcrRepository {
  repositoryName: string;
  repositoryArn?: string;
  repositoryUri?: string;
}

export const ecrModule: ServiceModule<EcrRepository> = {
  kind: "aws.ecr.repository",
  service: "ecr",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.ecr.repository", { account, region, naturalKey: data.repositoryName }),
      kind: "aws.ecr.repository",
      displayName: data.repositoryName,
      attributes: {
        region,
        accountRef: account,
        repositoryName: data.repositoryName,
        repositoryUri: data.repositoryUri,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};
