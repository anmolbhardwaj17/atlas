import { describe, it, expect } from "vitest";
import { parseJenkinsConfig, parseJenkinsCredentials } from "./config";

describe("parseJenkinsConfig", () => {
  it("defaults to https:// when the scheme is omitted (a bare host)", () => {
    expect(parseJenkinsConfig({ baseUrl: "jenkins.app.siemba.com" }).baseUrl).toBe(
      "https://jenkins.app.siemba.com",
    );
  });

  it("keeps an explicit scheme and strips a trailing slash", () => {
    expect(parseJenkinsConfig({ baseUrl: "https://ci.acme.com/" }).baseUrl).toBe(
      "https://ci.acme.com",
    );
    expect(parseJenkinsConfig({ baseUrl: "http://ci.acme.com" }).baseUrl).toBe(
      "http://ci.acme.com",
    );
  });

  it("requires a value", () => {
    expect(() => parseJenkinsConfig({})).toThrow(/required/);
  });
});

describe("parseJenkinsCredentials", () => {
  it("reads username + apiToken (and their aliases)", () => {
    expect(parseJenkinsCredentials({ username: "u", apiToken: "t" })).toEqual({
      username: "u",
      apiToken: "t",
    });
    expect(parseJenkinsCredentials({ user: "u", token: "t" })).toEqual({
      username: "u",
      apiToken: "t",
    });
  });

  it("rejects missing pieces", () => {
    expect(() => parseJenkinsCredentials({ username: "u" })).toThrow(/apiToken/);
    expect(() => parseJenkinsCredentials({ apiToken: "t" })).toThrow(/username/);
  });
});
