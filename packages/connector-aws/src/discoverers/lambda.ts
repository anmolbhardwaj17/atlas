/**
 * Lambda discoverer. ListFunctions returns full FunctionConfiguration objects
 * (name, role, runtime, env, vpc config), so a separate GetFunctionConfiguration is
 * unnecessary — discover+detail collapse (docs/06 §5.2).
 */
import { LambdaClient, paginateListFunctions } from "@aws-sdk/client-lambda";
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
        if (fn.FunctionName) yield emit(this, input, fn.FunctionName, fn);
      }
    }
  },
};
