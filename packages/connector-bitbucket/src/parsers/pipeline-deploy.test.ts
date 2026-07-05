import { describe, expect, it } from "vitest";
import { parsePipelineDeploys } from "./pipeline-deploy";

describe("parsePipelineDeploys", () => {
  it("extracts ECR image pushes (tag/digest stripped, deduped)", () => {
    const yml = `
pipelines:
  branches:
    main:
      - step:
          script:
            - docker build -t 851725189424.dkr.ecr.us-east-1.amazonaws.com/calsaws-chat:latest .
            - docker push 851725189424.dkr.ecr.us-east-1.amazonaws.com/calsaws-chat:latest
            - docker push 851725189424.dkr.ecr.us-east-1.amazonaws.com/team/api@sha256:abc123
`;
    const r = parsePipelineDeploys(yml);
    expect(r.ecrImages).toEqual([
      { account: "851725189424", region: "us-east-1", repository: "calsaws-chat" },
      { account: "851725189424", region: "us-east-1", repository: "team/api" },
    ]);
  });

  it("extracts ecs update-service and lambda update-function-code targets", () => {
    const yml = `
      - aws ecs update-service --cluster prod-cluster --service chat-api --force-new-deployment
      - aws lambda update-function-code --function-name calsaws-chat-processor --zip-file fileb://out.zip
      - aws lambda update-function-configuration --function-name calsaws-chat-processor --timeout 30
`;
    const r = parsePipelineDeploys(yml);
    expect(r.targets).toEqual([
      { kind: "ecs", cluster: "prod-cluster", service: "chat-api", environment: null },
      { kind: "lambda", function: "calsaws-chat-processor", environment: null },
    ]);
  });

  it("supports --flag=value form and quoted values", () => {
    const r = parsePipelineDeploys(`- aws ecs update-service --cluster=prod --service="my-svc"\n`);
    expect(r.targets).toEqual([
      { kind: "ecs", cluster: "prod", service: "my-svc", environment: null },
    ]);
  });

  it("SKIPS anything with unresolved variables - never guesses (P3)", () => {
    const yml = `
      - docker push $ECR_REGISTRY/\${IMAGE_NAME}:latest
      - aws ecs update-service --cluster \${CLUSTER} --service $SERVICE
      - aws lambda update-function-code --function-name \${FN_NAME}
`;
    const r = parsePipelineDeploys(yml);
    expect(r.ecrImages).toEqual([]);
    expect(r.targets).toEqual([]);
  });

  it("keeps the service when only the cluster is a variable (cluster becomes null)", () => {
    const r = parsePipelineDeploys(
      `- aws ecs update-service --cluster \${CLUSTER} --service chat-api\n`,
    );
    expect(r.targets).toEqual([
      { kind: "ecs", cluster: null, service: "chat-api", environment: null },
    ]);
  });

  it("expands repo/deployment variables per environment - the real-world shape", () => {
    const yml = `
      - aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment
      - docker push \${AWS_ACCOUNT_ID}.dkr.ecr.\${AWS_REGION}.amazonaws.com/\${IMAGE_NAME}:latest
`;
    const r = parsePipelineDeploys(yml, [
      {
        environment: "production-deploy",
        vars: {
          CLUSTER_NAME: "siemba-backend-production",
          SERVICE_NAME: "node_service",
          AWS_ACCOUNT_ID: "851725189424",
          AWS_REGION: "us-east-1",
          IMAGE_NAME: "siemba-production-backend",
        },
      },
      {
        environment: "demo-deploy",
        vars: { CLUSTER_NAME: "siemba-backend-demo", SERVICE_NAME: "node_service" },
      },
    ]);
    expect(r.targets).toEqual([
      {
        kind: "ecs",
        cluster: "siemba-backend-production",
        service: "node_service",
        environment: "production-deploy",
      },
      {
        kind: "ecs",
        cluster: "siemba-backend-demo",
        service: "node_service",
        environment: "demo-deploy",
      },
    ]);
    expect(r.ecrImages).toEqual([
      { account: "851725189424", region: "us-east-1", repository: "siemba-production-backend" },
    ]);
  });

  it("longest-key-first substitution: $NODE_SERVICE_NAME survives a shorter $NODE key", () => {
    const r = parsePipelineDeploys(
      `- aws ecs update-service --cluster prod --service $NODE_SERVICE_NAME\n`,
      [{ environment: "e", vars: { NODE: "n", NODE_SERVICE_NAME: "node-svc" } }],
    );
    expect(r.targets).toEqual([
      { kind: "ecs", cluster: "prod", service: "node-svc", environment: "e" },
    ]);
  });

  it("a secured (missing) variable still blocks extraction for that line only", () => {
    const yml = `
      - aws ecs update-service --cluster $CLUSTER --service $SECURED_NAME
      - aws lambda update-function-code --function-name $FN
`;
    const r = parsePipelineDeploys(yml, [
      { environment: "e", vars: { CLUSTER: "prod", FN: "resize" } },
    ]);
    expect(r.targets).toEqual([{ kind: "lambda", function: "resize", environment: "e" }]);
  });

  it("ignores comments and returns empty for a build-only pipeline", () => {
    const yml = `
# - aws ecs update-service --cluster x --service y
pipelines:
  default:
    - step:
        script:
          - npm ci && npm test
`;
    const r = parsePipelineDeploys(yml);
    expect(r.ecrImages).toEqual([]);
    expect(r.targets).toEqual([]);
  });
});
