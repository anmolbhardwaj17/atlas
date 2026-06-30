/**
 * Compute service modules: EC2 instance, Lambda function (docs/06 §4).
 * - EC2 emits CONTAINS(subnet→instance), PROTECTS(sg→instance) per attached SG, and
 *   ASSUMES_ROLE(instance→role) from its instance profile (docs/05 §4.1).
 * - Lambda emits ASSUMES_ROLE(fn→role) and PROTECTS(sg→fn) for VPC-attached functions;
 *   env vars become signals for the R3 env-reference inference (docs/05 §6.4).
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed, tagsToObject, roleUrnFromArn } from "./helpers";

interface Ec2Instance {
  InstanceId: string;
  InstanceType?: string;
  SubnetId?: string;
  VpcId?: string;
  PrivateIpAddress?: string;
  State?: { Name?: string };
  SecurityGroups?: Array<{ GroupId?: string; GroupName?: string }>;
  IamInstanceProfile?: { Arn?: string };
  Tags?: Array<{ Key?: string; Value?: string }>;
}

export const ec2Module: ServiceModule<Ec2Instance> = {
  kind: "aws.ec2.instance",
  service: "ec2",
  scope: "region",
  normalize({ account, region, data }) {
    const tags = tagsToObject(data.Tags);
    return {
      urn: awsUrn("aws.ec2.instance", { account, region, naturalKey: data.InstanceId }),
      kind: "aws.ec2.instance",
      displayName: tags.Name ?? data.InstanceId,
      attributes: {
        region,
        accountRef: account,
        instanceId: data.InstanceId,
        instanceType: data.InstanceType,
        vpcId: data.VpcId,
        subnetId: data.SubnetId,
        privateIp: data.PrivateIpAddress,
        state: data.State?.Name,
        tags,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.ec2.instance", { account, region, naturalKey: data.InstanceId });
    const edges = [];
    if (data.SubnetId) {
      const subnet = awsUrn("aws.subnet", { account, region, naturalKey: data.SubnetId });
      edges.push(observed("CONTAINS", subnet, self));
    }
    for (const sg of data.SecurityGroups ?? []) {
      if (sg.GroupId) {
        const sgUrn = awsUrn("aws.securitygroup", { account, region, naturalKey: sg.GroupId });
        edges.push(observed("PROTECTS", sgUrn, self));
      }
    }
    const roleUrn = data.IamInstanceProfile?.Arn
      ? roleUrnFromArn(data.IamInstanceProfile.Arn)
      : null;
    // An instance profile ARN names the profile, not the role; only emit when it resolves
    // to a role name (instance-profile and role often share a name) — else leave to G1.
    if (roleUrn) edges.push(observed("ASSUMES_ROLE", self, roleUrn));
    return edges;
  },
  extractSignals() {
    return [];
  },
};

interface LambdaFunction {
  FunctionName: string;
  FunctionArn?: string;
  Runtime?: string;
  Handler?: string;
  Role?: string;
  Environment?: { Variables?: Record<string, string> };
  VpcConfig?: { SubnetIds?: string[]; SecurityGroupIds?: string[] };
}

export const lambdaModule: ServiceModule<LambdaFunction> = {
  kind: "aws.lambda.function",
  service: "lambda",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.lambda.function", { account, region, naturalKey: data.FunctionName }),
      kind: "aws.lambda.function",
      displayName: data.FunctionName,
      attributes: {
        region,
        accountRef: account,
        functionName: data.FunctionName,
        runtime: data.Runtime,
        handler: data.Handler,
        role: data.Role,
        vpcConfig: data.VpcConfig ?? null,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.lambda.function", { account, region, naturalKey: data.FunctionName });
    const edges = [];
    const roleUrn = data.Role ? roleUrnFromArn(data.Role) : null;
    if (roleUrn) edges.push(observed("ASSUMES_ROLE", self, roleUrn));
    for (const sgId of data.VpcConfig?.SecurityGroupIds ?? []) {
      const sgUrn = awsUrn("aws.securitygroup", { account, region, naturalKey: sgId });
      edges.push(observed("PROTECTS", sgUrn, self));
    }
    return edges;
  },
  extractSignals({ account, region, data }) {
    const subjectUrn = awsUrn("aws.lambda.function", {
      account,
      region,
      naturalKey: data.FunctionName,
    });
    const vars = data.Environment?.Variables ?? {};
    if (Object.keys(vars).length === 0) return [];
    // Env var values may contain RDS endpoints / DynamoDB table names / S3 buckets → R3.
    return [{ kind: "aws.lambda.env", subjectUrn, data: { variables: vars } }];
  },
};
