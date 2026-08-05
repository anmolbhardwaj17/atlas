import { describe, it, expect, vi, afterEach } from "vitest";
import { registerCrashHandlers, resetCrashHandlersForTest } from "./crash-handlers";

/**
 * The asymmetry between the two handlers IS the design (a rejected background promise must not kill
 * a healthy pod; an uncaught throw must), so it's what's worth pinning down.
 */
describe("crash handlers", () => {
  afterEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
    resetCrashHandlersForTest();
    vi.restoreAllMocks();
  });

  // `process.listeners` is overloaded per event name; widen through unknown so one helper can drive
  // both events without fighting the union of their handler signatures.
  const emit = (event: "unhandledRejection" | "uncaughtException", err: unknown): void => {
    const listeners = (process.listeners as (e: string) => unknown[])(event);
    for (const l of listeners) (l as (e: unknown) => void)(err);
  };

  it("counts an unhandled rejection and does NOT exit — one bad promise must not kill the pod", () => {
    const count = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.useFakeTimers();

    registerCrashHandlers(count);
    emit("unhandledRejection", new Error("background post failed"));
    vi.runAllTimers();

    expect(count).toHaveBeenCalledWith("unhandled_rejection");
    expect(exit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("counts an uncaught exception and exits non-zero — unknown state is worse than a restart", () => {
    const count = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.useFakeTimers();

    registerCrashHandlers(count);
    emit("uncaughtException", new Error("boom"));

    expect(count).toHaveBeenCalledWith("uncaught_exception");
    expect(exit).not.toHaveBeenCalled(); // deferred so the log + metric can flush
    vi.runAllTimers();
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it("handles a non-Error rejection reason without throwing inside the handler", () => {
    const count = vi.fn();
    registerCrashHandlers(count);
    expect(() => emit("unhandledRejection", "just a string")).not.toThrow();
    expect(count).toHaveBeenCalledWith("unhandled_rejection");
  });

  // The API and worker boot the same module graph; registering twice would double-count and
  // double-log every crash.
  it("is idempotent across repeated registration", () => {
    const count = vi.fn();
    registerCrashHandlers(count);
    registerCrashHandlers(count);
    emit("unhandledRejection", new Error("once"));
    expect(count).toHaveBeenCalledTimes(1);
  });
});
