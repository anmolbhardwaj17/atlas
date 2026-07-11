/**
 * Standalone permission probes for per-resource security-posture reads (Security Phase 2b) that
 * aren't a discoverer's primary List/Describe — so a denial would otherwise be mis-attributed to the
 * discoverer's action. Each lists one resource and calls the posture API, letting ONLY AccessDenied
 * propagate → recorded as the precise missing IAM action (e.g. `s3:GetBucketPublicAccessBlock`). This
 * is what lets the Compliance page say "grant s3:GetBucketPublicAccessBlock" instead of a false pass.
 */
import { S3Client, ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { CloudTrailClient, DescribeTrailsCommand } from "@aws-sdk/client-cloudtrail";
import { LambdaClient, paginateListFunctions, GetFunctionCommand } from "@aws-sdk/client-lambda";
import { clientConfig } from "../aws/client-config";
import { classifyAwsError } from "../aws/retry";
import type { PermissionProbe } from "../permission-probe";

export const POSTURE_PROBES: readonly PermissionProbe[] = [
  {
    service: "s3-public-access",
    iamAction: "s3:GetBucketPublicAccessBlock",
    scope: "global",
    async probe(input) {
      const client = new S3Client(clientConfig(input.credentials, input.region ?? "us-east-1"));
      const list = await client.send(new ListBucketsCommand({}));
      const first = (list.Buckets ?? [])[0]?.Name;
      if (!first) return; // no buckets → nothing to probe (the capability is trivially satisfied)
      try {
        await client.send(new GetPublicAccessBlockCommand({ Bucket: first }));
      } catch (err) {
        if (classifyAwsError(err) === "access-denied") throw err;
        // NoSuchPublicAccessBlockConfiguration etc. → the permission works, there's just no config.
      }
    },
  },
  {
    service: "cloudtrail-config",
    iamAction: "cloudtrail:DescribeTrails",
    scope: "global",
    async probe(input) {
      const client = new CloudTrailClient(clientConfig(input.credentials, "us-east-1"));
      await client.send(new DescribeTrailsCommand({}));
    },
  },
  {
    // Deploy provenance for container Lambdas (Phase A → R17): the image URI (hence the build SHA)
    // is only reachable via GetFunction, a distinct permission from lambda:ListFunctions.
    service: "lambda-image",
    iamAction: "lambda:GetFunction",
    scope: "region",
    async probe(input) {
      const client = new LambdaClient(clientConfig(input.credentials, input.region ?? "us-east-1"));
      let first: string | undefined;
      for await (const page of paginateListFunctions({ client }, {})) {
        first = (page.Functions ?? [])[0]?.FunctionName;
        break;
      }
      if (!first) return; // no functions → nothing to probe
      await client.send(new GetFunctionCommand({ FunctionName: first }));
    },
  },
];
