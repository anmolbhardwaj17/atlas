/**
 * Data service modules: RDS instance, S3 bucket (docs/06 §4).
 * - RDS emits PROTECTS(sg→rds); its endpoint host:port + engine become a signal for the
 *   R3 connection inference (docs/05 §6.4). RDS is the target of inferred CONNECTS_TO.
 * - S3 emits TRIGGERS(s3→lambda) from bucket notification config. S3 is global-scoped
 *   (URN `aws:global:…`) though the bucket has a home region (kept in attributes).
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed, tagsToObject, lambdaUrnFromArn } from "./helpers";

interface RdsInstance {
  DBInstanceIdentifier: string;
  DBInstanceArn?: string;
  Engine?: string;
  EngineVersion?: string;
  Endpoint?: { Address?: string; Port?: number };
  MultiAZ?: boolean;
  VpcSecurityGroups?: Array<{ VpcSecurityGroupId?: string }>;
  DBSubnetGroup?: { VpcId?: string };
}

export const rdsModule: ServiceModule<RdsInstance> = {
  kind: "aws.rds.instance",
  service: "rds",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.rds.instance", { account, region, naturalKey: data.DBInstanceIdentifier }),
      kind: "aws.rds.instance",
      displayName: data.DBInstanceIdentifier,
      attributes: {
        region,
        accountRef: account,
        dbInstanceIdentifier: data.DBInstanceIdentifier,
        engine: data.Engine,
        engineVersion: data.EngineVersion,
        multiAz: data.MultiAZ === true,
        endpointAddress: data.Endpoint?.Address,
        endpointPort: data.Endpoint?.Port,
        vpcId: data.DBSubnetGroup?.VpcId,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.rds.instance", {
      account,
      region,
      naturalKey: data.DBInstanceIdentifier,
    });
    const edges = [];
    for (const sg of data.VpcSecurityGroups ?? []) {
      if (sg.VpcSecurityGroupId) {
        const sgUrn = awsUrn("aws.securitygroup", {
          account,
          region,
          naturalKey: sg.VpcSecurityGroupId,
        });
        edges.push(observed("PROTECTS", sgUrn, self));
      }
    }
    return edges;
  },
  extractSignals({ account, region, data }) {
    if (!data.Endpoint?.Address) return [];
    const subjectUrn = awsUrn("aws.rds.instance", {
      account,
      region,
      naturalKey: data.DBInstanceIdentifier,
    });
    // Endpoint host:port lets R3 match Lambda/ECS env vars referencing this DB.
    return [
      {
        kind: "aws.rds.endpoint",
        subjectUrn,
        data: { host: data.Endpoint.Address, port: data.Endpoint.Port, engine: data.Engine },
      },
    ];
  },
};

interface S3Bucket {
  Name: string;
  /** Resolved at fetch-detail from GetBucketLocation (null/"" means us-east-1). */
  LocationConstraint?: string | null;
  NotificationConfiguration?: {
    LambdaFunctionConfigurations?: Array<{ LambdaFunctionArn?: string; Events?: string[] }>;
  };
  TagSet?: Array<{ Key?: string; Value?: string }>;
}

export const s3Module: ServiceModule<S3Bucket> = {
  kind: "aws.s3.bucket",
  service: "s3",
  scope: "global",
  normalize({ account, data }) {
    const homeRegion = data.LocationConstraint || "us-east-1";
    return {
      urn: awsUrn("aws.s3.bucket", { account, naturalKey: data.Name }),
      kind: "aws.s3.bucket",
      displayName: data.Name,
      attributes: {
        region: homeRegion,
        accountRef: account,
        bucketName: data.Name,
        tags: tagsToObject(data.TagSet),
      },
    };
  },
  observedEdges({ account, data }) {
    const self = awsUrn("aws.s3.bucket", { account, naturalKey: data.Name });
    const edges = [];
    for (const n of data.NotificationConfiguration?.LambdaFunctionConfigurations ?? []) {
      const lambdaUrn = n.LambdaFunctionArn ? lambdaUrnFromArn(n.LambdaFunctionArn) : null;
      if (lambdaUrn) edges.push(observed("TRIGGERS", self, lambdaUrn, { events: n.Events }));
    }
    return edges;
  },
  extractSignals() {
    return [];
  },
};
