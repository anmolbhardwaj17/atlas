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

  // ── Atlassian AWS Pipes ────────────────────────────────────────────────────────────────────
  // Drawn from a real customer pipeline. The pipe form never writes a full
  // `<acct>.dkr.ecr.<region>.amazonaws.com/<repo>` URI, so the ECR regex had nothing to match and
  // this entire deploy style produced no evidence at all — verified against their file: zero
  // occurrences of "dkr.ecr" across every pipeline they have.
  it("reassembles an ECR image from aws-ecr-push-image (account from the OIDC role ARN)", () => {
    const yml = `
    - step: &push-to-ecr
        script:
          - docker build -t $IMAGE_NAME .
          - pipe: atlassian/aws-ecr-push-image:1.5.0
            variables:
              AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION
              AWS_OIDC_ROLE_ARN: 'arn:aws:iam::436061880215:role/Bitbucket-ECR-Pipeline-Role'
              IMAGE_NAME: \${IMAGE_NAME}
              TAGS: "latest"
`;
    const r = parsePipelineDeploys(yml, [
      {
        environment: "production-build",
        vars: { AWS_DEFAULT_REGION: "us-east-1", IMAGE_NAME: "siemba-backend" },
      },
    ]);
    expect(r.ecrImages).toEqual([
      { account: "436061880215", region: "us-east-1", repository: "siemba-backend" },
    ]);
  });

  it("reads aws-lambda-deploy and aws-ecs-deploy pipe variables", () => {
    const yml = `
        script:
          - pipe: atlassian/aws-lambda-deploy:1.9.0
            variables:
              FUNCTION_NAME: image-resizer
              COMMAND: 'update'
          - pipe: atlassian/aws-ecs-deploy:1.12.0
            variables:
              CLUSTER_NAME: prod-cluster
              SERVICE_NAME: checkout
`;
    const r = parsePipelineDeploys(yml);
    expect(r.targets).toEqual([
      { kind: "lambda", function: "image-resizer", environment: null },
      { kind: "ecs", cluster: "prod-cluster", service: "checkout", environment: null },
    ]);
  });

  it("drops a pipe ECR image when any part is unresolved — all three or nothing (P3)", () => {
    // Region never resolves. A half-known image would point at the wrong ECR repository, so the
    // whole reference is discarded rather than partially trusted.
    const yml = `
          - pipe: atlassian/aws-ecr-push-image:1.5.0
            variables:
              AWS_DEFAULT_REGION: $UNKNOWN_REGION
              AWS_OIDC_ROLE_ARN: 'arn:aws:iam::436061880215:role/R'
              IMAGE_NAME: svc
`;
    expect(parsePipelineDeploys(yml).ecrImages).toEqual([]);
  });

  it("does not leak variables across sibling pipes (indentation scopes the block)", () => {
    // The second pipe must not inherit FUNCTION_NAME from the first, which would invent a target.
    const yml = `
          - pipe: atlassian/aws-lambda-deploy:1.9.0
            variables:
              FUNCTION_NAME: only-mine
          - pipe: atlassian/aws-ecs-deploy:1.12.0
            variables:
              SERVICE_NAME: checkout
`;
    const r = parsePipelineDeploys(yml);
    expect(r.targets).toEqual([
      { kind: "lambda", function: "only-mine", environment: null },
      { kind: "ecs", cluster: null, service: "checkout", environment: null },
    ]);
  });

  it("ignores non-Atlassian and non-AWS pipes", () => {
    const yml = `
          - pipe: sonarsource/sonarqube-scan:1.0.0
            variables:
              SONAR_TOKEN: \${SONAR_TOKEN}
              FUNCTION_NAME: not-a-deploy
`;
    const r = parsePipelineDeploys(yml);
    expect(r.targets).toEqual([]);
    expect(r.ecrImages).toEqual([]);
  });
});
