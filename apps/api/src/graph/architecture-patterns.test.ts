import { describe, it, expect } from "vitest";
import { architectureProposals, type PatternNode } from "./architecture-patterns";

const rds = (id: string, name: string, multiAz: boolean): PatternNode => ({
  id,
  urn: `aws:us-east-1:111:rds:${name}`,
  kind: "aws.rds.instance",
  name,
  attributes: { multiAz },
});
const ec2 = (id: string, name: string): PatternNode => ({
  id,
  urn: `aws:us-east-1:111:ec2:${id}`,
  kind: "aws.ec2.instance",
  name,
  attributes: {},
});
const elb = (id: string, name: string): PatternNode => ({
  id,
  urn: `aws:us-east-1:111:elb:${name}`,
  kind: "aws.elb",
  name,
  attributes: {},
});

describe("architectureProposals", () => {
  it("single-AZ RDS → a Multi-AZ proposal (with a standby node + replication edge)", () => {
    const [p] = architectureProposals([rds("db1", "orders-db", false)], [], () => 2);
    expect(p).toBeDefined();
    expect(p!.category).toBe("reliability");
    expect(p!.title).toMatch(/Multi-AZ/);
    expect(p!.rationale).toMatch(/single Availability Zone/);
    expect(p!.rationale).toMatch(/2 resources depend/);
    expect(p!.proposed.nodes.some((n) => n.state === "added" && /standby/.test(n.label))).toBe(
      true,
    );
    expect(p!.proposed.edges.some((e) => e.state === "added")).toBe(true);
    expect(p!.current.nodes).toHaveLength(1);
  });

  it("a Multi-AZ RDS produces no proposal", () => {
    expect(architectureProposals([rds("db", "d", true)], [], () => 0)).toHaveLength(0);
  });

  it("standalone EC2 → an ECS/Fargate + ALB proposal", () => {
    const [p] = architectureProposals([ec2("i1", "report-server")], [], () => 0);
    expect(p).toBeDefined();
    expect(p!.category).toBe("scalability");
    expect(p!.title).toMatch(/ECS Fargate behind a load balancer/);
    expect(p!.proposed.nodes.some((n) => n.kind === "aws.elb" && n.state === "added")).toBe(true);
    expect(p!.proposed.nodes.some((n) => n.kind === "aws.ecs.service")).toBe(true);
  });

  it("an EC2 already behind a load balancer is not proposed for ECS", () => {
    const e = elb("lb", "alb");
    const i = ec2("i1", "web");
    const props = architectureProposals(
      [e, i],
      [{ from: e.id, to: i.id, type: "ROUTES_TO" }],
      () => 0,
    );
    expect(props.filter((p) => p.id.startsWith("ecsalb"))).toHaveLength(0);
  });

  it("infra EC2s (VPN / Jenkins / migration) are skipped (P3)", () => {
    const props = architectureProposals(
      [
        ec2("i1", "calsaws-OpenVPN"),
        ec2("i2", "calsaws-Jenkins-server"),
        ec2("i3", "db-migration"),
      ],
      [],
      () => 0,
    );
    expect(props).toHaveLength(0);
  });
});
