import { describe, it, expect } from "vitest";
import { parseJiraConfig } from "./config";

/**
 * Jira config parsing — security-critical: `site` is interpolated into the request base URL
 * (`https://<site>.atlassian.net/…`) and `projectKeys` into a JQL literal, so both are strictly
 * validated. These tests pin the SSRF + JQL-injection guards.
 */
describe("parseJiraConfig — site slug (SSRF guard)", () => {
  it("accepts a bare slug, a full host, a URL, and normalizes case", () => {
    expect(parseJiraConfig({ site: "acme" }).site).toBe("acme");
    expect(parseJiraConfig({ site: "acme.atlassian.net" }).site).toBe("acme");
    expect(parseJiraConfig({ site: "https://acme.atlassian.net" }).site).toBe("acme");
    expect(parseJiraConfig({ site: "https://acme.atlassian.net/jira/x" }).site).toBe("acme");
    expect(parseJiraConfig({ site: "ACME" }).site).toBe("acme");
    expect(parseJiraConfig({ site: "my-team-1" }).site).toBe("my-team-1");
  });

  it("REJECTS anything that could relocate the request host", () => {
    for (const bad of [
      "169.254.169.254:80#", // cloud metadata via URL fragment
      "evil.com#", // exfiltrate creds off-platform
      "acme.atlassian.net#evil",
      "acme.atlassian.net@evil.com",
      "sub.acme.atlassian.net", // multi-label
      "acme.evil.com",
      "acme:8080",
      "10.0.0.1",
      "",
      "   ",
    ]) {
      expect(() => parseJiraConfig({ site: bad }), `site="${bad}" must throw`).toThrow();
    }
  });
});

describe("parseJiraConfig — projectKeys (JQL-injection guard)", () => {
  it("keeps valid keys (upper-cased) and drops anything with an out-of-charset character", () => {
    const cfg = parseJiraConfig({
      site: "acme",
      projectKeys: ["ENG", "ops", 'X" OR 1=1 --', "TOO-LONG-KEY-NAME", "A B", "PROJ1"],
    });
    expect(cfg.projectKeys).toEqual(["ENG", "OPS", "PROJ1"]);
  });

  it("omits projectKeys entirely when none survive validation", () => {
    expect(parseJiraConfig({ site: "acme", projectKeys: ['"; DROP'] }).projectKeys).toBeUndefined();
  });
});
