/**
 * Service-module registry (docs/06 §9). The connector dispatches the pure transforms
 * (normalize/observedEdges/extractSignals) and builds the work plan from this list, so
 * adding a service is a one-line registration here plus the module + node_kinds row.
 *
 * Coverage: VPC, Subnet, Security Group, EC2, Lambda, ECS (cluster/service/taskdef), ECR,
 * ELB, Route53, RDS, S3, IAM role — exercising every observed edge type in docs/05 §4
 * (CONTAINS, PROTECTS, ASSUMES_ROLE, USES_IMAGE, ROUTES_TO, TRIGGERS) — plus the additive
 * services DynamoDB, ElastiCache, and API Gateway (docs/06 §9, `./additive`). IAM *policy*
 * is intentionally not a browsable node (NG6); its statements feed R8 via the IAM-role
 * module's signal. (Live discoverers for the additive kinds land with their fetch layer.)
 */
import type { ServiceModule } from "./module";
import { vpcModule, subnetModule, securityGroupModule } from "./networking";
import { ec2Module, lambdaModule } from "./compute";
import { ecsClusterModule, ecsServiceModule, ecsTaskDefModule, ecrModule } from "./ecs";
import { elbModule, route53Module } from "./routing";
import { rdsModule, s3Module } from "./data";
import { iamRoleModule } from "./identity";
import { dynamodbModule, elasticacheModule, apigatewayModule } from "./additive";

export const SERVICE_MODULES: ReadonlyArray<ServiceModule> = [
  vpcModule,
  subnetModule,
  securityGroupModule,
  ec2Module,
  lambdaModule,
  ecsClusterModule,
  ecsServiceModule,
  ecsTaskDefModule,
  ecrModule,
  elbModule,
  route53Module,
  rdsModule,
  s3Module,
  iamRoleModule,
  dynamodbModule,
  elasticacheModule,
  apigatewayModule,
];

/** kind → module (the dispatch table for normalize/observedEdges/extractSignals). */
export const MODULE_BY_KIND: ReadonlyMap<string, ServiceModule> = new Map(
  SERVICE_MODULES.map((m) => [m.kind, m]),
);

export type { ServiceModule, AwsRawPayload } from "./module";
