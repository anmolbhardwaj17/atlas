import { describe, it, expect } from "vitest";
import { classifyAwsError, withRetry } from "./retry";

describe("classifyAwsError", () => {
  it("classifies the docs/06 §7.3 error families", () => {
    expect(classifyAwsError({ name: "ThrottlingException" })).toBe("throttling");
    expect(classifyAwsError({ name: "RequestLimitExceeded" })).toBe("throttling");
    expect(classifyAwsError({ $metadata: { httpStatusCode: 429 } })).toBe("throttling");
    expect(classifyAwsError({ name: "AccessDenied" })).toBe("access-denied");
    expect(classifyAwsError({ name: "UnauthorizedOperation" })).toBe("access-denied");
    expect(classifyAwsError({ name: "ResourceNotFoundException" })).toBe("not-found");
    expect(classifyAwsError({ name: "TimeoutError" })).toBe("transient");
    expect(classifyAwsError({ $metadata: { httpStatusCode: 500 } })).toBe("transient");
    expect(classifyAwsError({ name: "ValidationError" })).toBe("fatal");
  });

  it("classifies an expired session token as transient, NOT access-denied (CX1)", () => {
    // AWS returns 403 for an expired token; without the dedicated branch it would read as
    // access-denied (a false missing-permission) and never retry → silent data loss on a >1h crawl.
    expect(classifyAwsError({ name: "ExpiredToken", $metadata: { httpStatusCode: 403 } })).toBe(
      "transient",
    );
    expect(
      classifyAwsError({ name: "ExpiredTokenException", $metadata: { httpStatusCode: 403 } }),
    ).toBe("transient");
    // A genuine permission gap must still classify as access-denied.
    expect(classifyAwsError({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } })).toBe(
      "access-denied",
    );
  });
});

describe("withRetry", () => {
  const noSleep = async (): Promise<void> => undefined;

  it("returns the value on success", async () => {
    expect(await withRetry(async () => 42)).toBe(42);
  });

  it("retries throttling/transient then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error("slow"), { name: "ThrottlingException" });
        return "ok";
      },
      { sleep: noSleep, rng: () => 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does NOT retry access-denied (surfaces immediately for permission detection)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("no"), { name: "AccessDenied" });
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/no/);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts on persistent throttling", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("slow"), { name: "ThrottlingException" });
        },
        { sleep: noSleep, rng: () => 0, maxAttempts: 4 },
      ),
    ).rejects.toThrow(/slow/);
    expect(calls).toBe(4);
  });
});
