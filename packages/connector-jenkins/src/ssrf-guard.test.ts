import { describe, expect, it } from "vitest";
import {
  assertHostAllowed,
  assertResolvesToPublic,
  isBlockedIp,
  SsrfBlockedError,
} from "./ssrf-guard";

describe("isBlockedIp", () => {
  it("blocks IPv4 private / loopback / link-local / CGNAT ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "52.94.0.1", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback / link-local / unique-local + IPv4-mapped internals", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6 and blocks junk", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare
    expect(isBlockedIp("not-an-ip")).toBe(true); // fail closed
  });
});

describe("assertHostAllowed (parse-time literal check)", () => {
  it("rejects literal private IPs and internal names", () => {
    for (const h of [
      "127.0.0.1",
      "169.254.169.254",
      "10.1.2.3",
      "[::1]",
      "localhost",
      "foo.localhost",
      "svc.internal",
      "printer.local",
    ]) {
      expect(() => assertHostAllowed(h), h).toThrow(SsrfBlockedError);
    }
  });

  it("allows public hostnames and IPs", () => {
    for (const h of ["ci.acme.com", "jenkins.example.io", "8.8.8.8"]) {
      expect(() => assertHostAllowed(h), h).not.toThrow();
    }
  });
});

describe("assertResolvesToPublic (request-time DNS check)", () => {
  it("refuses a public name that resolves to a private IP (rebinding / internal mapping)", async () => {
    const resolver = async () => [{ address: "10.0.0.7" }];
    await expect(assertResolvesToPublic("evil.example.com", resolver)).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it("refuses when ANY resolved address is private (mixed answer)", async () => {
    const resolver = async () => [{ address: "8.8.8.8" }, { address: "169.254.169.254" }];
    await expect(assertResolvesToPublic("mixed.example.com", resolver)).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it("allows a public name that resolves to a public IP", async () => {
    const resolver = async () => [{ address: "52.1.2.3" }];
    await expect(assertResolvesToPublic("ci.acme.com", resolver)).resolves.toBeUndefined();
  });

  it("refuses on DNS failure or empty answer (fail closed)", async () => {
    const boom = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertResolvesToPublic("nope.example.com", boom)).rejects.toThrow(
      SsrfBlockedError,
    );
    const empty = async () => [];
    await expect(assertResolvesToPublic("empty.example.com", empty)).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it("classifies a literal IP host without hitting DNS", async () => {
    const shouldNotRun = async () => {
      throw new Error("resolver should not be called for a literal IP");
    };
    await expect(assertResolvesToPublic("127.0.0.1", shouldNotRun)).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertResolvesToPublic("8.8.8.8", shouldNotRun)).resolves.toBeUndefined();
  });
});
