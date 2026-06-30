/**
 * Discoverer registry — the live-crawl counterpart to the pure SERVICE_MODULES (I1.3).
 * Indexed by service key (matches plan() scope params) and by node kind. The connector
 * resolves a discoverer per scope; permission probes are derived from these (docs/06 §8).
 */
import type { Discoverer } from "../aws/discoverer";
import {
  ec2InstanceDiscoverer,
  vpcDiscoverer,
  subnetDiscoverer,
  securityGroupDiscoverer,
} from "./ec2";
import { lambdaDiscoverer } from "./lambda";
import { ecsClusterDiscoverer, ecsServiceDiscoverer, ecsTaskDefDiscoverer } from "./ecs";
import { ecrDiscoverer, rdsDiscoverer } from "./simple";
import { elbDiscoverer } from "./elb";
import { route53Discoverer } from "./route53";
import { s3Discoverer } from "./s3";
import { iamRoleDiscoverer } from "./iam";

export const DISCOVERERS: ReadonlyArray<Discoverer> = [
  vpcDiscoverer,
  subnetDiscoverer,
  securityGroupDiscoverer,
  ec2InstanceDiscoverer,
  lambdaDiscoverer,
  ecsClusterDiscoverer,
  ecsServiceDiscoverer,
  ecsTaskDefDiscoverer,
  ecrDiscoverer,
  elbDiscoverer,
  route53Discoverer,
  rdsDiscoverer,
  s3Discoverer,
  iamRoleDiscoverer,
];

export const DISCOVERER_BY_SERVICE: ReadonlyMap<string, Discoverer> = new Map(
  DISCOVERERS.map((d) => [d.service, d]),
);
