/**
 * Lambda discoverer. ListFunctions returns full FunctionConfiguration objects (name, role, runtime,
 * env, vpc config, Description, Version, CodeSha256, LastModified, PackageType) — so a separate
 * GetFunctionConfiguration is unnecessary (discover+detail collapse, docs/06 §5.2).
 *
 * Two fields ListFunctions omits, both deploy provenance for R17 (`lambda_commit_provenance`):
 *  - the container **image URI** (its tag carries the build SHA) — only via `GetFunction`, and only
 *    meaningful for `PackageType: Image` functions.
 *  - the function **tags** (CI often stamps `git-sha`/`commit`/`revision`) — via `GetFunction.Tags`
 *    for image functions (free, same call) or a targeted `ListTags` for zip functions.
 * Each is a DISTINCT permission from `lambda:ListFunctions` — a denial must not be mis-attributed to
 * the list action, so both are caught here (best-effort, R17 degrades to the remaining SHA witnesses)
 * and surfaced instead by the standalone `lambda:GetFunction` / `lambda:ListTags` posture probes.
 */
import {
  LambdaClient,
  paginateListFunctions,
  GetFunctionCommand,
  ListTagsCommand,
} from "@aws-sdk/client-lambda";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

export const lambdaDiscoverer: Discoverer = {
  service: "lambda",
  scope: "region",
  kind: "aws.lambda.function",
  iamAction: "lambda:ListFunctions",
  async *crawl(input) {
    const client = new LambdaClient(clientConfig(input.credentials, input.region));
    for await (const page of paginateListFunctions({ client }, {})) {
      for (const fn of page.Functions ?? []) {
        if (!fn.FunctionName) continue;
        let imageUri: string | undefined;
        let tags: Record<string, string> | undefined;
        if (fn.PackageType === "Image") {
          // GetFunction yields both the image URI AND the tags in one call — capture both.
          try {
            const detail = await client.send(
              new GetFunctionCommand({ FunctionName: fn.FunctionName }),
            );
            imageUri = detail.Code?.ImageUri;
            tags = detail.Tags;
          } catch {
            imageUri = undefined;
          }
        }
        // Zip functions (no GetFunction call above) still need their tags for R17 — one cheap
        // ListTags by ARN. Best-effort: a denial just leaves tags unset (surfaced by the probe).
        if (!tags && fn.FunctionArn) {
          try {
            const res = await client.send(new ListTagsCommand({ Resource: fn.FunctionArn }));
            tags = res.Tags;
          } catch {
            tags = undefined;
          }
        }
        const extra = {
          ...(imageUri ? { ImageUri: imageUri } : {}),
          ...(tags && Object.keys(tags).length > 0 ? { Tags: tags } : {}),
        };
        yield emit(
          this,
          input,
          fn.FunctionName,
          Object.keys(extra).length > 0 ? { ...fn, ...extra } : fn,
        );
      }
    }
  },
};
