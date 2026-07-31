import { describe, it, expect, vi, afterEach } from "vitest";
import { FetchGithubClient, nextLink } from "./client";

const noSleep = async (): Promise<void> => undefined;

afterEach(() => vi.unstubAllGlobals());

function res(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

describe("nextLink", () => {
  it("extracts the rel=next URL", () => {
    const link =
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';
    expect(nextLink(link)).toBe("https://api.github.com/x?page=2");
    expect(nextLink('<https://x>; rel="last"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});

describe("FetchGithubClient", () => {
  it("paginates across Link pages and extracts itemsKey", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(
          { repositories: [{ name: "a" }, { name: "b" }] },
          {
            headers: {
              link: '<https://api.github.com/installation/repositories?page=2>; rel="next"',
            },
          },
        ),
      )
      .mockResolvedValueOnce(res({ repositories: [{ name: "c" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchGithubClient({ token: "t", sleep: noSleep });
    const names: string[] = [];
    for await (const r of client.paginate<{ name: string }>("/installation/repositories", {
      itemsKey: "repositories",
    })) {
      names.push(r.name);
    }
    expect(names).toEqual(["a", "b", "c"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits out a primary rate limit then retries (docs/07 §10)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(
          { message: "rate limited" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1001" },
          },
        ),
      )
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchGithubClient({ token: "t", sleep: noSleep, now: () => 1_000_000 });
    const out = await client.request<{ ok: boolean }>("/rate");
    expect(out.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ e: 1 }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchGithubClient({ token: "t", sleep: noSleep, maxAttempts: 3 });
    await expect(client.request("/boom")).rejects.toThrow(/GitHub 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a thrown network error then succeeds (CH1)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchGithubClient({ token: "t", sleep: noSleep, rng: () => 0 });
    const out = await client.request<{ ok: boolean }>("/flaky");
    expect(out.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a caller-aborted fetch (CH1)", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchGithubClient({ token: "t", sleep: noSleep });
    await expect(client.request("/x", { signal: ac.signal })).rejects.toThrow(/aborted/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off and retries a secondary rate limit without retry-after (CH2)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(
          { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
          { status: 403, headers: { "x-ratelimit-remaining": "4999" } },
        ),
      )
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchGithubClient({ token: "t", sleep: noSleep, rng: () => 0 });
    const out = await client.request<{ ok: boolean }>("/secondary");
    expect(out.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a plain permission 403 (CH2 guard)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        res({ message: "Resource not accessible by integration" }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchGithubClient({ token: "t", sleep: noSleep, maxAttempts: 5 });
    await expect(client.request("/forbidden")).rejects.toThrow(/GitHub 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
