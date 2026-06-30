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
