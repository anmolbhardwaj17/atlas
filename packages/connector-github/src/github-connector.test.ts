import { describe, it, expect } from "vitest";
import type { Connection, SecretAccessor } from "@atlas/connector-sdk";
import { GithubConnector } from "./github-connector";
import {
  InstallationAuthError,
  type InstallationToken,
  type InstallationTokenInput,
  type InstallationTokenProvider,
} from "./auth";

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    orgId: "org-1",
    provider: "github",
    displayName: "acme org",
    config: { appId: "123", installationId: "456" },
    secretRef: "mem:org-1:key",
    ...overrides,
  };
}

const okSecrets: SecretAccessor = { get: async () => ({ privateKey: "PEM" }) };

const ALL_PERMS = {
  metadata: "read",
  contents: "read",
  pull_requests: "read",
  actions: "read",
  members: "read",
};

function tokenProvider(
  permissions: Record<string, string>,
  captured?: (i: InstallationTokenInput) => void,
): InstallationTokenProvider {
  return {
    getInstallationToken: async (input): Promise<InstallationToken> => {
      captured?.(input);
      return { token: "ghs_x", expiresAt: null, permissions, repositorySelection: "all" };
    },
  };
}

describe("GithubConnector.verify", () => {
  it("connected when the token grants every required read", async () => {
    let seen: InstallationTokenInput | undefined;
    const c = new GithubConnector({
      auth: tokenProvider(ALL_PERMS, (i) => (seen = i)),
      secrets: okSecrets,
    });
    expect(await c.verify(conn())).toEqual({ status: "connected" });
    expect(seen).toMatchObject({ appId: "123", installationId: "456", privateKey: "PEM" });
  });

  it("degraded with the missing reads when a permission is not granted (docs/07 §2)", async () => {
    const { actions: _a, members: _m, ...partial } = ALL_PERMS;
    void _a;
    void _m;
    const c = new GithubConnector({ auth: tokenProvider(partial), secrets: okSecrets });
    const r = await c.verify(conn());
    expect(r.status).toBe("degraded");
    expect(r.missingPermissions?.sort()).toEqual(["actions:read", "members:read"]);
  });

  it("error when the token exchange fails (bad key / app not installed)", async () => {
    const auth: InstallationTokenProvider = {
      getInstallationToken: async () => {
        throw new InstallationAuthError("installation not found");
      },
    };
    const r = await new GithubConnector({ auth, secrets: okSecrets }).verify(conn());
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/installation not found/);
  });

  it("error for bad config or missing private key", async () => {
    const c = new GithubConnector({ auth: tokenProvider(ALL_PERMS), secrets: okSecrets });
    expect((await c.verify(conn({ config: { appId: "x" } }))).status).toBe("error");
    expect((await c.verify(conn({ secretRef: null }))).status).toBe("error");

    const noKey = new GithubConnector({
      auth: tokenProvider(ALL_PERMS),
      secrets: { get: async () => ({}) },
    });
    expect((await noKey.verify(conn())).status).toBe("error");
  });

  it("health() runs the same probe", async () => {
    const c = new GithubConnector({ auth: tokenProvider(ALL_PERMS), secrets: okSecrets });
    expect((await c.health(conn())).status).toBe("connected");
  });
});
