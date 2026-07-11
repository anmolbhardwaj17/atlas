/**
 * Lambda discoverer. ListFunctions returns full FunctionConfiguration objects (name, role, runtime,
 * env, vpc config, Description, Version, CodeSha256, LastModified, PackageType) — so a separate
 * GetFunctionConfiguration is unnecessary (discover+detail collapse, docs/06 §5.2).
 *
 * The one field ListFunctions omits is the container image URI, which is the strongest deploy
 * provenance for a container Lambda (its tag carries the build SHA → R17). We fetch it with a single
 * `GetFunction` per `PackageType: Image` function (zip Lambdas need no extra call). GetFunction is a
 * DISTINCT permission — a denial there must not be mis-attributed to `lambda:ListFunctions`, so it's
 * caught here and surfaced instead by the standalone `lambda:GetFunction` posture probe.
 */
import { LambdaClient, paginateListFunctions, GetFunctionCommand } from "@aws-sdk/client-lambda";
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
        if (fn.PackageType === "Image") {
          // Best-effort: the image URI is only reachable via GetFunction. A missing permission or any
          // error just leaves imageUri unset (R17 falls back to description/tag SHAs); never fails the
          // crawl. The dedicated probe reports the permission gap honestly.
          try {
            const detail = await client.send(
              new GetFunctionCommand({ FunctionName: fn.FunctionName }),
            );
            imageUri = detail.Code?.ImageUri;
          } catch {
            imageUri = undefined;
          }
        }
        yield emit(this, input, fn.FunctionName, imageUri ? { ...fn, ImageUri: imageUri } : fn);
      }
    }
  },
};
