import { describe, it, expect } from "vitest";
import { deriveSlug, isValidSlug } from "./slug";

describe("isValidSlug", () => {
  it("matches the DB constraint ^[a-z0-9-]{3,40}$", () => {
    expect(isValidSlug("acme")).toBe(true);
    expect(isValidSlug("a-b-1")).toBe(true);
    expect(isValidSlug("ab")).toBe(false); // too short
    expect(isValidSlug("Acme")).toBe(false); // uppercase
    expect(isValidSlug("a".repeat(41))).toBe(false); // too long
  });
});

describe("deriveSlug", () => {
  it("slugifies a display name", () => {
    expect(deriveSlug("Acme Inc")).toBe("acme-inc");
    expect(deriveSlug("  Hello!!  World  ")).toBe("hello-world");
  });

  it("pads short results to satisfy the >=3 constraint", () => {
    expect(isValidSlug(deriveSlug("AI"))).toBe(true);
    expect(isValidSlug(deriveSlug("!"))).toBe(true);
  });

  it("always produces a valid slug", () => {
    for (const name of ["Acme", "X Y Z", "café déjà", "团队", "  "]) {
      expect(isValidSlug(deriveSlug(name || "fallback"))).toBe(true);
    }
  });
});
