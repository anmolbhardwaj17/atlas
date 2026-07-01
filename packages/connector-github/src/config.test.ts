import { describe, it, expect } from "vitest";
import { parseGithubConfig } from "./config";
import { missingPermissions, REQUIRED_PERMISSIONS } from "./permissions";

describe("parseGithubConfig", () => {
  it("accepts numeric appId/installationId (string or number)", () => {
    expect(parseGithubConfig({ appId: "123", installationId: 456 })).toEqual({
      appId: "123",
      installationId: "456",
    });
  });
  it("rejects missing/non-numeric fields", () => {
    expect(() => parseGithubConfig({ installationId: "1" })).toThrow(/appId/);
    expect(() => parseGithubConfig({ appId: "x", installationId: "1" })).toThrow(/appId/);
    expect(() => parseGithubConfig({ appId: "1" })).toThrow(/installationId/);
  });
});

describe("missingPermissions", () => {
  const all = Object.fromEntries(REQUIRED_PERMISSIONS.map((p) => [p.key, "read"]));

  it("returns [] when all required reads are granted", () => {
    expect(missingPermissions(all)).toEqual([]);
    expect(missingPermissions({ ...all, contents: "write" })).toEqual([]); // write ⊇ read
  });
  it("reports each missing/insufficient read as key:read", () => {
    const { contents: _c, actions: _a, ...partial } = all;
    void _c;
    void _a;
    expect(missingPermissions(partial).sort()).toEqual(["actions:read", "contents:read"]);
    expect(missingPermissions(undefined).length).toBe(REQUIRED_PERMISSIONS.length);
  });
});
