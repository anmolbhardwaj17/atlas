import { describe, expect, it } from "vitest";
import { deterministicHeadline } from "./proactive-incidents.service";

const NOW = 1_700_000_000_000;
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("deterministicHeadline", () => {
  it("a recent config change → config-change (with time-before)", () => {
    const r = deterministicHeadline({
      now: NOW,
      events: [{ kind: "config_change", occurredAt: minAgo(4) }],
      unhealthyDeps: [],
    });
    expect(r.classification).toBe("config-change");
    expect(r.summary).toContain("4 min before");
  });

  it("a recent deploy → code-change", () => {
    const r = deterministicHeadline({
      now: NOW,
      events: [{ kind: "deploy", occurredAt: minAgo(10) }],
      unhealthyDeps: [],
    });
    expect(r.classification).toBe("code-change");
  });

  it("a merged PR → code-change", () => {
    const r = deterministicHeadline({
      now: NOW,
      events: [{ kind: "pr_merged", occurredAt: minAgo(2) }],
      unhealthyDeps: [],
    });
    expect(r.classification).toBe("code-change");
    expect(r.summary).toContain("merged PR");
  });

  it("no recent change but a failing dependency → dependency", () => {
    const r = deterministicHeadline({
      now: NOW,
      // a change 10h ago is outside the 6h window → doesn't count.
      events: [{ kind: "config_change", occurredAt: minAgo(600) }],
      unhealthyDeps: [{ name: "prod-db", kind: "aws.rds.instance" }],
    });
    expect(r.classification).toBe("dependency");
    expect(r.summary).toContain("prod-db");
  });

  it("nothing correlates → unknown (never invents a cause, P3)", () => {
    expect(deterministicHeadline({ now: NOW, events: [], unhealthyDeps: [] }).classification).toBe(
      "unknown",
    );
  });

  it("ignores non-change events (only deploy/config/pr count)", () => {
    const r = deterministicHeadline({
      now: NOW,
      events: [{ kind: "health_transition", occurredAt: minAgo(1) }],
      unhealthyDeps: [],
    });
    expect(r.classification).toBe("unknown");
  });
});
