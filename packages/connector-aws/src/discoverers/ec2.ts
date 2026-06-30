/**
 * EC2-family discoverers (one client covers VPC/Subnet/SG/EC2). All four describe
 * calls paginate and return full objects, so discover+detail collapse (docs/06 §5.2).
 */
import {
  EC2Client,
  paginateDescribeInstances,
  paginateDescribeVpcs,
  paginateDescribeSubnets,
  paginateDescribeSecurityGroups,
} from "@aws-sdk/client-ec2";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

export const ec2InstanceDiscoverer: Discoverer = {
  service: "ec2",
  scope: "region",
  kind: "aws.ec2.instance",
  iamAction: "ec2:DescribeInstances",
  async *crawl(input) {
    const client = new EC2Client(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeInstances({ client }, {})) {
      for (const reservation of page.Reservations ?? []) {
        for (const inst of reservation.Instances ?? []) {
          if (inst.InstanceId) yield emit(this, input, inst.InstanceId, inst);
        }
      }
    }
  },
};

export const vpcDiscoverer: Discoverer = {
  service: "vpc",
  scope: "region",
  kind: "aws.vpc",
  iamAction: "ec2:DescribeVpcs",
  async *crawl(input) {
    const client = new EC2Client(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeVpcs({ client }, {})) {
      for (const vpc of page.Vpcs ?? []) {
        if (vpc.VpcId) yield emit(this, input, vpc.VpcId, vpc);
      }
    }
  },
};

export const subnetDiscoverer: Discoverer = {
  service: "subnet",
  scope: "region",
  kind: "aws.subnet",
  iamAction: "ec2:DescribeSubnets",
  async *crawl(input) {
    const client = new EC2Client(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeSubnets({ client }, {})) {
      for (const subnet of page.Subnets ?? []) {
        if (subnet.SubnetId) yield emit(this, input, subnet.SubnetId, subnet);
      }
    }
  },
};

export const securityGroupDiscoverer: Discoverer = {
  service: "securitygroup",
  scope: "region",
  kind: "aws.securitygroup",
  iamAction: "ec2:DescribeSecurityGroups",
  async *crawl(input) {
    const client = new EC2Client(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeSecurityGroups({ client }, {})) {
      for (const sg of page.SecurityGroups ?? []) {
        if (sg.GroupId) yield emit(this, input, sg.GroupId, sg);
      }
    }
  },
};
