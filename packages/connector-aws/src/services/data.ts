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
  StorageEncrypted?: boolean;
  /** Whether the DB has a public endpoint (public IP), reachable from outside the VPC — feeds the
   *  Phase E `rds-public` posture finding. Same DescribeDBInstances response as the fields above, so
   *  no extra IAM permission. */
  PubliclyAccessible?: boolean;
  VpcSecurityGroups?: Array<{ VpcSecurityGroupId?: string }>;
  DBSubnetGroup?: { VpcId?: string };
  /** DescribeDBInstances returns tags inline as `TagList` ({Key,Value}); feeds R11. */
  TagList?: Array<{ Key?: string; Value?: string }>;
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
        storageEncrypted: data.StorageEncrypted === true,
        publiclyAccessible: data.PubliclyAccessible === true,
        endpointAddress: data.Endpoint?.Address,
        endpointPort: data.Endpoint?.Port,
        vpcId: data.DBSubnetGroup?.VpcId,
        tags: tagsToObject(data.TagList),
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
  // Security posture (Phase 2b) — see the S3 discoverer.
  publicAccessKnown?: boolean;
  publicAccessBlock?: Record<string, boolean> | null;
  policyIsPublic?: boolean | null;
  aclPublic?: boolean | null;
  encrypted?: boolean | null;
}

export const s3Module: ServiceModule<S3Bucket> = {
  kind: "aws.s3.bucket",
  service: "s3",
  scope: "global",
  normalize({ account, data }) {
    const homeRegion = data.LocationConstraint || "us-east-1";
    // A bucket is PUBLIC only when an account/bucket public-access-block doesn't fully block it AND
    // its policy is public OR its ACL grants to AllUsers/AuthenticatedUsers. If we couldn't read the
    // posture (denied), `isPublic` is null (unknown) — never a false "not public".
    const pab = data.publicAccessBlock;
    const fullyBlocked =
      !!pab &&
      pab.BlockPublicAcls === true &&
      pab.IgnorePublicAcls === true &&
      pab.BlockPublicPolicy === true &&
      pab.RestrictPublicBuckets === true;
    const isPublic =
      data.publicAccessKnown === false
        ? null
        : !fullyBlocked && (data.policyIsPublic === true || data.aclPublic === true);
    return {
      urn: awsUrn("aws.s3.bucket", { account, naturalKey: data.Name }),
      kind: "aws.s3.bucket",
      displayName: data.Name,
      attributes: {
        region: homeRegion,
        accountRef: account,
        bucketName: data.Name,
        tags: tagsToObject(data.TagSet),
        isPublic,
        publicAccessKnown: data.publicAccessKnown ?? null,
        encrypted: data.encrypted ?? null,
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
