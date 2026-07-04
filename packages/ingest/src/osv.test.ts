import { describe, it, expect } from "vitest";
import { OsvClient, pkgKey, type OsvQueryPkg } from "./osv";

const LODASH: OsvQueryPkg = { name: "lodash", version: "4.17.11", ecosystem: "npm" };
const SAFE: OsvQueryPkg = { name: "safe-pkg", version: "1.0.0", ecosystem: "npm" };

/** Fake OSV: batch returns a vuln for lodash only; the detail is a GHSA HIGH with a fix. */
function fakeFetch(): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/querybatch")) {
      const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      const results = body.queries.map((q) =>
        q.package.name === "lodash" ? { vulns: [{ id: "GHSA-jf85-cpcp-j695" }] } : {},
      );
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    if (String(url).includes("/vulns/")) {
      return new Response(
        JSON.stringify({
          id: "GHSA-jf85-cpcp-j695",
          summary: "Prototype Pollution in lodash",
          aliases: ["CVE-2019-10744"],
          published: "2019-07-26T00:00:00Z",
          database_specific: { severity: "HIGH" },
          affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.12" }] }] }],
          references: [
            { type: "WEB", url: "https://example.com/x" },
            { type: "ADVISORY", url: "https://github.com/advisories/GHSA-jf85-cpcp-j695" },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("OsvClient", () => {
  it("scans packages → vulnerabilities, mapping severity + fix + advisory", async () => {
    const osv = new OsvClient({ fetchImpl: fakeFetch() });
    const results = await osv.scan([LODASH, SAFE]);

    const lodash = results.find((r) => pkgKey(r.pkg) === pkgKey(LODASH));
    const safe = results.find((r) => pkgKey(r.pkg) === pkgKey(SAFE));

    expect(lodash?.vulnerabilities).toHaveLength(1);
    expect(lodash?.vulnerabilities[0]).toMatchObject({
      id: "GHSA-jf85-cpcp-j695",
      severity: "high",
      fixedVersion: "4.17.12",
      aliases: ["CVE-2019-10744"],
      reference: "https://github.com/advisories/GHSA-jf85-cpcp-j695", // prefers ADVISORY
    });
    expect(safe?.vulnerabilities).toHaveLength(0);
  });

  it("is best-effort — a failed OSV call yields no vulns, never throws", async () => {
    const boom = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const osv = new OsvClient({ fetchImpl: boom });
    await expect(osv.scan([LODASH])).resolves.toEqual([{ pkg: LODASH, vulnerabilities: [] }]);
  });
});
