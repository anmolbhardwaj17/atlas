import { describe, it, expect } from "vitest";
import type { Connection, SecretAccessor } from "@atlas/connector-sdk";
import { JenkinsConnector } from "./jenkins-connector";
import { JenkinsHttpError, type JenkinsClient } from "./client";

const secrets: SecretAccessor = {
  get: async () => ({ username: "anmol", apiToken: "tok" }),
};

const conn = {
  id: "c1",
  orgId: "o1",
  provider: "jenkins",
  displayName: "Jenkins",
  config: { baseUrl: "https://jenkins.app.siemba.com" },
  secretRef: "ref",
} as unknown as Connection;

/** A connector whose Jenkins client's every GET throws `err` (or, with no arg, succeeds). */
function connectorWhereJsonThrows(err?: unknown): JenkinsConnector {
  const client: JenkinsClient = {
    json: async <T>() => {
      if (err) throw err;
      return { jobs: [] } as T;
    },
    text: async () => null,
  };
  return new JenkinsConnector({ secrets, clientFactory: () => client });
}

describe("JenkinsConnector.verify — reachability vs auth classification", () => {
  it("connects when the tree API responds", async () => {
    expect((await connectorWhereJsonThrows().verify(conn)).status).toBe("connected");
  });

  it("a network/reachability failure → error with allowlist-our-IP guidance (not a token error)", async () => {
    const r = await connectorWhereJsonThrows(new TypeError("fetch failed")).verify(conn);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/allowlist Atlas/i);
    expect(r.message).toMatch(/jenkins\.app\.siemba\.com/);
    expect(r.message).toMatch(/credentials are saved/i);
    expect(r.message).not.toMatch(/rejected the credentials/i);
  });

  it("a 401/403 → a credentials problem (not a network one)", async () => {
    const r = await connectorWhereJsonThrows(new JenkinsHttpError(403, "/api/json")).verify(conn);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/credentials/i);
    expect(r.message).not.toMatch(/allowlist/i);
  });

  it("a 404 → a wrong-server-URL hint", async () => {
    const r = await connectorWhereJsonThrows(new JenkinsHttpError(404, "/api/json")).verify(conn);
    expect(r.message).toMatch(/server URL/i);
  });
});
