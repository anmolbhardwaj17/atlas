import { describe, it, expect } from "vitest";
import type { AwsRawPayload, ServiceModule } from "./module";
import { vpcModule, subnetModule, securityGroupModule } from "./networking";
import { ec2Module, lambdaModule } from "./compute";
import { ecsClusterModule, ecsServiceModule, ecsTaskDefModule, ecrModule } from "./ecs";
import { elbModule, route53Module } from "./routing";
import { rdsModule, s3Module } from "./data";
import { iamRoleModule } from "./identity";
import { SERVICE_MODULES, MODULE_BY_KIND } from "./index";

const ACCT = "123456789012";
const REGION = "us-east-1";

/** Golden-fixture helper: wrap a describe payload as the connector would (docs/06 §5). */
function p<T>(data: T, region = REGION): AwsRawPayload<T> {
  return { account: ACCT, region, data };
}
function edgeOf(edges: ReturnType<ServiceModule["observedEdges"]>, type: string) {
  return edges.filter((e) => e.type === type);
}
function first<T>(a: readonly T[]): T {
  const v = a[0];
  if (v === undefined) throw new Error("expected at least one element");
  return v;
}

describe("registry", () => {
  it("registers every module under its kind and all are observed-origin pure", () => {
    expect(MODULE_BY_KIND.size).toBe(SERVICE_MODULES.length);
    for (const m of SERVICE_MODULES) {
      expect(MODULE_BY_KIND.get(m.kind)).toBe(m);
    }
  });
});

describe("networking", () => {
  it("VPC → node, no edges", () => {
    const node = vpcModule.normalize(
      p({ VpcId: "vpc-1", CidrBlock: "10.0.0.0/16", Tags: [{ Key: "Name", Value: "prod" }] }),
    );
    expect(node.urn).toBe("aws:us-east-1:123456789012:vpc:vpc-1");
    expect(node.displayName).toBe("prod");
    expect(node.attributes.region).toBe(REGION);
    expect(node.attributes.accountRef).toBe(ACCT);
  });

  it("Subnet → CONTAINS(vpc→subnet)", () => {
    const raw = p({
      SubnetId: "subnet-1",
      VpcId: "vpc-1",
      CidrBlock: "10.0.1.0/24",
      AvailabilityZone: "us-east-1a",
    });
    expect(subnetModule.normalize(raw).urn).toBe("aws:us-east-1:123456789012:subnet:subnet-1");
    const [edge] = subnetModule.observedEdges(raw);
    expect(edge).toMatchObject({
      type: "CONTAINS",
      fromUrn: "aws:us-east-1:123456789012:vpc:vpc-1",
      toUrn: "aws:us-east-1:123456789012:subnet:subnet-1",
      origin: "observed",
    });
  });

  it("Security Group → node + rules signal, no observed edges", () => {
    const raw = p({
      GroupId: "sg-1",
      GroupName: "db-sg",
      VpcId: "vpc-1",
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 5432,
          ToPort: 5432,
          UserIdGroupPairs: [{ GroupId: "sg-app" }],
        },
      ],
      IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
    });
    expect(securityGroupModule.observedEdges(raw)).toEqual([]);
    const sig = first(securityGroupModule.extractSignals(raw));
    expect(sig.kind).toBe("aws.sg.rules");
    expect(sig.subjectUrn).toBe("aws:us-east-1:123456789012:sg:sg-1");
    expect(first(sig.data.ingress as unknown[])).toMatchObject({
      fromPort: 5432,
      groupRefs: ["sg-app"],
    });
  });
});

describe("compute", () => {
  it("EC2 → CONTAINS(subnet→ec2), PROTECTS(sg→ec2)×n, ASSUMES_ROLE(ec2→role)", () => {
    const raw = p({
      InstanceId: "i-0abc",
      InstanceType: "t3.micro",
      SubnetId: "subnet-1",
      VpcId: "vpc-1",
      SecurityGroups: [{ GroupId: "sg-1" }, { GroupId: "sg-2" }],
      IamInstanceProfile: { Arn: "arn:aws:iam::123456789012:instance-profile/app-role" },
      Tags: [{ Key: "Name", Value: "web-1" }],
    });
    expect(ec2Module.normalize(raw).displayName).toBe("web-1");
    const edges = ec2Module.observedEdges(raw);
    expect(edgeOf(edges, "CONTAINS")).toEqual([
      {
        type: "CONTAINS",
        fromUrn: "aws:us-east-1:123456789012:subnet:subnet-1",
        toUrn: "aws:us-east-1:123456789012:ec2:i-0abc",
        origin: "observed",
      },
    ]);
    expect(edgeOf(edges, "PROTECTS").map((e) => e.fromUrn)).toEqual([
      "aws:us-east-1:123456789012:sg:sg-1",
      "aws:us-east-1:123456789012:sg:sg-2",
    ]);
    expect(edgeOf(edges, "ASSUMES_ROLE")[0]).toMatchObject({
      fromUrn: "aws:us-east-1:123456789012:ec2:i-0abc",
      toUrn: "aws:global:123456789012:iam-role:app-role",
    });
  });

  it("Lambda → ASSUMES_ROLE + PROTECTS for VPC SGs + env signal", () => {
    const raw = p({
      FunctionName: "resize-images",
      Role: "arn:aws:iam::123456789012:role/resize-role",
      Runtime: "nodejs20.x",
      Environment: { Variables: { TABLE: "images", BUCKET: "assets" } },
      VpcConfig: { SubnetIds: ["subnet-1"], SecurityGroupIds: ["sg-9"] },
    });
    const edges = lambdaModule.observedEdges(raw);
    expect(edgeOf(edges, "ASSUMES_ROLE")[0]).toMatchObject({
      fromUrn: "aws:us-east-1:123456789012:lambda:resize-images",
      toUrn: "aws:global:123456789012:iam-role:resize-role",
    });
    expect(edgeOf(edges, "PROTECTS")[0]).toMatchObject({
      fromUrn: "aws:us-east-1:123456789012:sg:sg-9",
    });
    const sig = first(lambdaModule.extractSignals(raw));
    expect(sig).toMatchObject({ kind: "aws.lambda.env" });
    expect(sig.data.variables).toEqual({ TABLE: "images", BUCKET: "assets" });
  });
});

describe("ecs + ecr", () => {
  it("ECS service → CONTAINS(cluster→service) with cluster/service URN", () => {
    const raw = p({
      serviceName: "orders-api",
      clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/prod",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/orders:7",
      desiredCount: 3,
      loadBalancers: [
        {
          targetGroupArn:
            "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/orders/abc",
        },
      ],
    });
    expect(ecsServiceModule.normalize(raw).urn).toBe(
      "aws:us-east-1:123456789012:ecs-service:prod/orders-api",
    );
    expect(ecsServiceModule.observedEdges(raw)[0]).toMatchObject({
      type: "CONTAINS",
      fromUrn: "aws:us-east-1:123456789012:ecs-cluster:prod",
      toUrn: "aws:us-east-1:123456789012:ecs-service:prod/orders-api",
    });
    expect(ecsServiceModule.extractSignals(raw)[0]).toMatchObject({ kind: "aws.ecs.targetgroups" });
  });

  it("ECS taskdef → USES_IMAGE(taskdef→ecr) + ASSUMES_ROLE×2 + env signal", () => {
    const raw = p({
      family: "orders",
      revision: 7,
      taskRoleArn: "arn:aws:iam::123456789012:role/orders-task",
      executionRoleArn: "arn:aws:iam::123456789012:role/ecs-exec",
      containerDefinitions: [
        {
          name: "app",
          image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/orders:1.4.2",
          environment: [{ name: "DB_HOST", value: "orders.abc.us-east-1.rds.amazonaws.com" }],
        },
        { name: "sidecar", image: "public.ecr.aws/nginx/nginx:latest" }, // non-ECR → no edge
      ],
    });
    const edges = ecsTaskDefModule.observedEdges(raw);
    expect(edgeOf(edges, "USES_IMAGE")).toEqual([
      {
        type: "USES_IMAGE",
        fromUrn: "aws:us-east-1:123456789012:ecs-taskdef:orders",
        toUrn: "aws:us-east-1:123456789012:ecr:orders",
        origin: "observed",
        attributes: { tag: "1.4.2" },
      },
    ]);
    expect(edgeOf(edges, "ASSUMES_ROLE").map((e) => e.toUrn)).toEqual([
      "aws:global:123456789012:iam-role:orders-task",
      "aws:global:123456789012:iam-role:ecs-exec",
    ]);
    expect(first(ecsTaskDefModule.extractSignals(raw)).data.variables).toEqual({
      DB_HOST: "orders.abc.us-east-1.rds.amazonaws.com",
    });
  });

  it("ECR repo + ECS cluster → nodes only", () => {
    expect(ecrModule.normalize(p({ repositoryName: "orders", repositoryUri: "x" })).urn).toBe(
      "aws:us-east-1:123456789012:ecr:orders",
    );
    expect(ecsClusterModule.normalize(p({ clusterName: "prod" })).urn).toBe(
      "aws:us-east-1:123456789012:ecs-cluster:prod",
    );
    expect(ecrModule.observedEdges(p({ repositoryName: "orders" }))).toEqual([]);
  });
});

describe("routing", () => {
  it("ELB → ROUTES_TO(elb→instance) for instance targets + PROTECTS(sg→elb)", () => {
    const raw = p({
      LoadBalancerName: "prod-alb",
      DNSName: "prod-alb-123.us-east-1.elb.amazonaws.com",
      Type: "application",
      SecurityGroups: ["sg-lb"],
      TargetGroups: [
        {
          TargetGroupArn: "tg-1",
          TargetType: "instance",
          Targets: [{ Id: "i-0abc" }, { Id: "i-0def" }],
        },
        { TargetGroupArn: "tg-2", TargetType: "ip", Targets: [{ Id: "10.0.0.5" }] },
      ],
    });
    const edges = elbModule.observedEdges(raw);
    expect(edgeOf(edges, "PROTECTS")[0]).toMatchObject({
      fromUrn: "aws:us-east-1:123456789012:sg:sg-lb",
    });
    expect(edgeOf(edges, "ROUTES_TO").map((e) => e.toUrn)).toEqual([
      "aws:us-east-1:123456789012:ec2:i-0abc",
      "aws:us-east-1:123456789012:ec2:i-0def",
    ]); // ip target excluded (not an EC2 node)
  });

  it("Route53 → alias signal, no observed edge (P3)", () => {
    const raw = p({
      Name: "api.acme.com.",
      Type: "A",
      HostedZoneId: "Z123",
      AliasTarget: { DNSName: "prod-alb-123.us-east-1.elb.amazonaws.com", HostedZoneId: "Z456" },
    });
    expect(route53Module.normalize(raw).urn).toBe(
      "aws:global:123456789012:route53:Z123/api.acme.com./A",
    );
    expect(route53Module.observedEdges(raw)).toEqual([]);
    expect(route53Module.extractSignals(raw)[0]).toMatchObject({
      kind: "aws.route53.alias",
      data: { target: "prod-alb-123.us-east-1.elb.amazonaws.com" },
    });
  });
});

describe("data + identity", () => {
  it("RDS → PROTECTS(sg→rds) + endpoint signal", () => {
    const raw = p({
      DBInstanceIdentifier: "prod-orders",
      Engine: "postgres",
      EngineVersion: "15.4",
      Endpoint: { Address: "prod-orders.abc.us-east-1.rds.amazonaws.com", Port: 5432 },
      VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-db" }],
      DBSubnetGroup: { VpcId: "vpc-1" },
    });
    expect(rdsModule.normalize(raw).urn).toBe("aws:us-east-1:123456789012:rds:prod-orders");
    expect(rdsModule.observedEdges(raw)[0]).toMatchObject({
      type: "PROTECTS",
      fromUrn: "aws:us-east-1:123456789012:sg:sg-db",
      toUrn: "aws:us-east-1:123456789012:rds:prod-orders",
    });
    expect(rdsModule.extractSignals(raw)[0]).toMatchObject({
      kind: "aws.rds.endpoint",
      data: { host: "prod-orders.abc.us-east-1.rds.amazonaws.com", port: 5432, engine: "postgres" },
    });
  });

  it("S3 → global URN + TRIGGERS(s3→lambda) from notifications", () => {
    const raw = p(
      {
        Name: "acme-prod-assets",
        LocationConstraint: "us-west-2",
        NotificationConfiguration: {
          LambdaFunctionConfigurations: [
            {
              LambdaFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:resize-images",
              Events: ["s3:ObjectCreated:*"],
            },
          ],
        },
      },
      "global",
    );
    const node = s3Module.normalize(raw);
    expect(node.urn).toBe("aws:global:123456789012:s3:acme-prod-assets");
    expect(node.attributes.region).toBe("us-west-2"); // home region kept in attrs
    expect(s3Module.observedEdges(raw)[0]).toMatchObject({
      type: "TRIGGERS",
      fromUrn: "aws:global:123456789012:s3:acme-prod-assets",
      toUrn: "aws:us-east-1:123456789012:lambda:resize-images",
    });
  });

  it("IAM role → global node + policy-statements signal (R8), no observed edges", () => {
    const raw = p(
      {
        RoleName: "orders-task",
        Arn: "arn:aws:iam::123456789012:role/orders-task",
        PolicyStatements: [
          {
            Effect: "Allow",
            Action: ["dynamodb:GetItem"],
            Resource: "arn:aws:dynamodb:us-east-1:123456789012:table/orders",
          },
        ],
      },
      "global",
    );
    expect(iamRoleModule.normalize(raw).urn).toBe("aws:global:123456789012:iam-role:orders-task");
    expect(iamRoleModule.observedEdges(raw)).toEqual([]);
    const sig = first(iamRoleModule.extractSignals(raw));
    expect(sig).toMatchObject({ kind: "aws.iam.policy_statements" });
    expect(first(sig.data.statements as unknown[])).toMatchObject({
      effect: "Allow",
      actions: ["dynamodb:GetItem"],
    });
  });
});
