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
} from "@aws-sdk/client-s3";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";
import { classifyAwsError } from "../aws/retry";

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

      yield emit(this, input, Name, {
        Name,
        LocationConstraint,
        NotificationConfiguration,
        TagSet,
      });
    }
  },
};
