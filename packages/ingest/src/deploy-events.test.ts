import { describe, expect, it } from "vitest";
import { lambdaDeployEvent, ecsDeployEvent } from "./deploy-events";

const URN = "aws:us-east-1:111122223333:lambda:calsaws-chat-SendMessage";

describe("lambdaDeployEvent", () => {
  it("maps a Lambda's LastModified to a deploy event with a timestamp-scoped dedupe key", () => {
    const e = lambdaDeployEvent(URN, "calsaws-chat-SendMessage", {
      lastModified: "2026-07-11T14:02:33.123+0000",
      version: "$LATEST",
      packageType: "Zip",
      codeSha256: "hZ8k2f+notacommit=",
    });
    expect(e).not.toBeNull();
    expect(e).toMatchObject({
      urn: URN,
      kind: "deploy",
      occurredAt: "2026-07-11T14:02:33.123Z",
      title: "calsaws-chat-SendMessage deployed",
      source: "aws-lambda",
      evidence: { via: "lambda-last-modified", version: "$LATEST", packageType: "Zip" },
    });
    // Dedupe key is (urn, timestamp) only — a redeploy (new LastModified) makes a new event; the
    // codeSha256 (a zip hash) is evidence, never part of identity.
    expect(e?.dedupeKey).toBe(`deploy:${URN}:2026-07-11T14:02:33.123Z`);
  });

  it("returns null when there's no usable LastModified (never fabricates a deploy)", () => {
    expect(lambdaDeployEvent(URN, "fn", {})).toBeNull();
    expect(lambdaDeployEvent(URN, "fn", { lastModified: "" })).toBeNull();
    expect(lambdaDeployEvent(URN, "fn", { lastModified: "not-a-date" })).toBeNull();
  });

  it("omits optional evidence fields that are absent, and falls back to the URN for a label", () => {
    const e = lambdaDeployEvent(URN, null, { lastModified: "2026-07-11T14:02:33Z" });
    expect(e?.title).toBe("calsaws-chat-SendMessage deployed");
    expect(e?.evidence).toEqual({ via: "lambda-last-modified" });
  });
});

describe("ecsDeployEvent", () => {
  const ECS = "aws:us-east-1:111122223333:ecs-service:prod/backend-api";
  it("maps the ECS PRIMARY deployment time to a deploy event", () => {
    const e = ecsDeployEvent(ECS, "backend-api", {
      lastDeployedAt: "2026-07-11T14:02:33.000Z",
      taskDefinition: "arn:aws:ecs:us-east-1:111122223333:task-definition/backend-api:7",
    });
    expect(e).toMatchObject({
      kind: "deploy",
      occurredAt: "2026-07-11T14:02:33.000Z",
      source: "aws-ecs",
      evidence: { via: "ecs-primary-deployment" },
    });
    expect(e?.dedupeKey).toBe(`deploy:${ECS}:2026-07-11T14:02:33.000Z`);
  });
  it("returns null when there's no deployment time", () => {
    expect(ecsDeployEvent(ECS, "svc", {})).toBeNull();
  });
});
