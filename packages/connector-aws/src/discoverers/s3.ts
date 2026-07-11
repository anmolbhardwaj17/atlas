/**
 * S3 discoverer (global). Lists buckets, then per bucket reads location, Lambda
 * notification config (for TRIGGERS edges) and tags. Only bucket *config* is read —
 * never object data (docs/13 §4: no s3:GetObject in the policy).
 */
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketTaggingCommand,
  GetPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
  GetBucketAclCommand,
  GetBucketEncryptionCommand,
} from "@aws-sdk/client-s3";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";
import { classifyAwsError } from "../aws/retry";

const isDenied = (err: unknown): boolean => classifyAwsError(err) === "access-denied";
const errName = (err: unknown): string => (err as { name?: string })?.name ?? "";

export const s3Discoverer: Discoverer = {
  service: "s3",
  scope: "global",
  kind: "aws.s3.bucket",
  iamAction: "s3:ListAllMyBuckets",
  async *crawl(input) {
    const client = new S3Client(clientConfig(input.credentials, input.region));
    const list = await client.send(new ListBucketsCommand({}));
    for (const bucket of list.Buckets ?? []) {
      const Name = bucket.Name;
      if (!Name) continue;

      const loc = await client.send(new GetBucketLocationCommand({ Bucket: Name }));
      const LocationConstraint = loc.LocationConstraint ?? null;

      let NotificationConfiguration: unknown = {};
      try {
        const n = await client.send(
          new GetBucketNotificationConfigurationCommand({ Bucket: Name }),
        );
        NotificationConfiguration = {
          LambdaFunctionConfigurations: n.LambdaFunctionConfigurations ?? [],
        };
      } catch (err) {
        if (classifyAwsError(err) === "access-denied") throw err; // surfaces as missing perm
      }

      let TagSet: unknown[] = [];
      try {
        const t = await client.send(new GetBucketTaggingCommand({ Bucket: Name }));
        TagSet = t.TagSet ?? [];
      } catch {
        // NoSuchTagSet (no tags) is normal — leave empty.
      }

      // Security posture (Phase 2b): public-access-block + policy status + ACL + encryption. These
      // are GRACEFUL — a denied posture read leaves the fact `unknown` (never a false "not public")
      // instead of failing the whole S3 scope; a dedicated posture probe surfaces the missing
      // permission by name (s3:GetBucketPublicAccessBlock).
      let publicAccessKnown = true;
      let publicAccessBlock: Record<string, boolean> | null = null;
      try {
        const pab = await client.send(new GetPublicAccessBlockCommand({ Bucket: Name }));
        publicAccessBlock =
          (pab.PublicAccessBlockConfiguration as Record<string, boolean> | undefined) ?? null;
      } catch (err) {
        if (/NoSuchPublicAccessBlockConfiguration/i.test(errName(err))) publicAccessBlock = null;
        else if (isDenied(err)) publicAccessKnown = false;
      }

      let policyIsPublic: boolean | null = null;
      try {
        const ps = await client.send(new GetBucketPolicyStatusCommand({ Bucket: Name }));
        policyIsPublic = ps.PolicyStatus?.IsPublic ?? false;
      } catch (err) {
        if (/NoSuchBucketPolicy/i.test(errName(err))) policyIsPublic = false;
        else if (isDenied(err)) publicAccessKnown = false;
      }

      let aclPublic = false;
      try {
        const acl = await client.send(new GetBucketAclCommand({ Bucket: Name }));
        aclPublic = (acl.Grants ?? []).some((g) =>
          /AllUsers|AuthenticatedUsers/.test(g.Grantee?.URI ?? ""),
        );
      } catch (err) {
        if (isDenied(err)) publicAccessKnown = false;
      }

      let encrypted: boolean | null = null;
      try {
        const enc = await client.send(new GetBucketEncryptionCommand({ Bucket: Name }));
        encrypted = (enc.ServerSideEncryptionConfiguration?.Rules?.length ?? 0) > 0;
      } catch (err) {
        if (/ServerSideEncryptionConfigurationNotFoundError/i.test(errName(err))) encrypted = false;
        else if (isDenied(err)) encrypted = null; // unknown
      }

      yield emit(this, input, Name, {
        Name,
        LocationConstraint,
        NotificationConfiguration,
        TagSet,
        publicAccessKnown,
        publicAccessBlock,
        policyIsPublic,
        aclPublic,
        encrypted,
      });
    }
  },
};
