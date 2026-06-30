/**
 * Networking service modules: VPC, Subnet, Security Group (docs/06 §4).
 * - Subnet emits CONTAINS(vpc→subnet) — structural containment (docs/05 §4.1).
 * - Security Group emits NO observed edges itself; PROTECTS(sg→resource) is emitted by
 *   the protected resource (which references the SG). SG rules become signals for the
 *   R2 SG-correlation inference (docs/05 §6.4).
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed, tagsToObject } from "./helpers";

interface Vpc {
  VpcId: string;
  CidrBlock?: string;
  Tags?: Array<{ Key?: string; Value?: string }>;
}

export const vpcModule: ServiceModule<Vpc> = {
  kind: "aws.vpc",
  service: "vpc",
  scope: "region",
  normalize({ account, region, data }) {
    const tags = tagsToObject(data.Tags);
    return {
      urn: awsUrn("aws.vpc", { account, region, naturalKey: data.VpcId }),
      kind: "aws.vpc",
      displayName: tags.Name ?? data.VpcId,
      attributes: {
        region,
        accountRef: account,
        vpcId: data.VpcId,
        cidrBlock: data.CidrBlock,
        tags,
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

interface Subnet {
  SubnetId: string;
  VpcId: string;
  CidrBlock?: string;
  AvailabilityZone?: string;
  Tags?: Array<{ Key?: string; Value?: string }>;
}

export const subnetModule: ServiceModule<Subnet> = {
  kind: "aws.subnet",
  service: "subnet",
  scope: "region",
  normalize({ account, region, data }) {
    const tags = tagsToObject(data.Tags);
    return {
      urn: awsUrn("aws.subnet", { account, region, naturalKey: data.SubnetId }),
      kind: "aws.subnet",
      displayName: tags.Name ?? data.SubnetId,
      attributes: {
        region,
        accountRef: account,
        subnetId: data.SubnetId,
        vpcId: data.VpcId,
        cidrBlock: data.CidrBlock,
        availabilityZone: data.AvailabilityZone,
        tags,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const vpc = awsUrn("aws.vpc", { account, region, naturalKey: data.VpcId });
    const subnet = awsUrn("aws.subnet", { account, region, naturalKey: data.SubnetId });
    return [observed("CONTAINS", vpc, subnet)];
  },
  extractSignals() {
    return [];
  },
};

interface IpPermission {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string }>;
  UserIdGroupPairs?: Array<{ GroupId?: string }>;
}
interface SecurityGroup {
  GroupId: string;
  GroupName?: string;
  VpcId?: string;
  IpPermissions?: IpPermission[];
  IpPermissionsEgress?: IpPermission[];
  Tags?: Array<{ Key?: string; Value?: string }>;
}

export const securityGroupModule: ServiceModule<SecurityGroup> = {
  kind: "aws.securitygroup",
  service: "securitygroup",
  scope: "region",
  normalize({ account, region, data }) {
    const tags = tagsToObject(data.Tags);
    return {
      urn: awsUrn("aws.securitygroup", { account, region, naturalKey: data.GroupId }),
      kind: "aws.securitygroup",
      displayName: data.GroupName ?? tags.Name ?? data.GroupId,
      attributes: {
        region,
        accountRef: account,
        groupId: data.GroupId,
        groupName: data.GroupName,
        vpcId: data.VpcId,
        tags,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals({ account, region, data }) {
    const subjectUrn = awsUrn("aws.securitygroup", { account, region, naturalKey: data.GroupId });
    // SG ingress/egress rules feed R2 (sg-correlation CONNECTS_TO inference, docs/05 §6.4).
    return [
      {
        kind: "aws.sg.rules",
        subjectUrn,
        data: {
          vpcId: data.VpcId,
          ingress: (data.IpPermissions ?? []).map(rule),
          egress: (data.IpPermissionsEgress ?? []).map(rule),
        },
      },
    ];
  },
};

function rule(r: IpPermission): Record<string, unknown> {
  return {
    protocol: r.IpProtocol,
    fromPort: r.FromPort,
    toPort: r.ToPort,
    cidrs: (r.IpRanges ?? []).map((x) => x.CidrIp).filter(Boolean),
    groupRefs: (r.UserIdGroupPairs ?? []).map((x) => x.GroupId).filter(Boolean),
  };
}
