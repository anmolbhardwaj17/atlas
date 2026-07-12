import { describe, expect, it } from "vitest";
import { parseJiraConfig } from "./config";
import { discoverIssuesByKeys } from "./jira/crawl";
import { JiraHttpError, type JiraClient, type JiraResponse } from "./jira/client";
import { readContext } from "./modules/context";

/**
 * Reference-driven crawl (IV / long-term scale): fetch the SPECIFIC tickets our PRs reference that a
 * recent-N crawl misses, so linking scales to any backlog. Two units tested: config `backfillKeys`
 * validation, and `discoverIssuesByKeys` (chunked JQL `key in (...)`, tolerant of a bad chunk).
 */

describe("parseJiraConfig backfillKeys", () => {
  it("validates, upper-cases, de-dupes, and drops non-key garbage", () => {
    const cfg = parseJiraConfig({
      site: "acme.atlassian.net",
      backfillKeys: ["roar-2558", "ROAR-2558", "ROAR-4457", "not a key", "", 42],
    });
    expect(cfg.backfillKeys).toEqual(["ROAR-2558", "ROAR-4457"]);
  });

  it("omits backfillKeys when none are valid", () => {
    expect(parseJiraConfig({ site: "acme", backfillKeys: ["nope"] }).backfillKeys).toBeUndefined();
  });
});

/** A JiraClient whose `request` is driven by a handler over (path, jql). */
function fakeClient(handler: (jql: string) => JiraResponse<unknown>): JiraClient {
  return {
    async request<T>(_path: string, opts?: { params?: Record<string, unknown> }) {
      return handler(String(opts?.params?.jql ?? "")) as JiraResponse<T>;
    },
    async *paginate() {},
  };
}
const ok = (issues: unknown[]): JiraResponse<unknown> => ({
  status: 200,
  data: { issues, isLast: true },
  headers: new Headers(),
});

async function collect(it: AsyncIterable<{ ref: unknown; payload: unknown }>) {
  const out: Array<{ ref: unknown; payload: unknown }> = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("discoverIssuesByKeys", () => {
  it("fetches issues by key via JQL `key in (...)` and stamps site context", async () => {
    const client = fakeClient((jql) => {
      expect(jql).toContain('key in ("ROAR-2558","ROAR-4457")');
      return ok([
        { key: "ROAR-2558", fields: {} },
        { key: "ROAR-4457", fields: {} },
      ]);
    });
    const out = await collect(
      discoverIssuesByKeys(client, "acme", ["ROAR-2558", "ROAR-4457"], "issues-by-key:acme"),
    );
    expect(out.map((o) => (o.ref as { externalId: string }).externalId)).toEqual([
      "issue:ROAR-2558",
      "issue:ROAR-4457",
    ]);
    expect(readContext(out[0]?.payload).site).toBe("acme");
  });

  it("skips a bad chunk (4xx) without failing the rest", async () => {
    const client = fakeClient((jql) => {
      if (jql.includes("BAD-1")) throw new JiraHttpError(400, "/search/jql");
      return ok([{ key: "GOOD-2", fields: {} }]);
    });
    // Two keys, chunk size is 50, so both are in one chunk → the 400 skips the whole chunk.
    const out = await collect(
      discoverIssuesByKeys(client, "acme", ["BAD-1"], "issues-by-key:acme"),
    );
    expect(out).toEqual([]); // tolerated, no throw
  });
});
