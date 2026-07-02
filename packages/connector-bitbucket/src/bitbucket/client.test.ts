import { describe, it, expect, vi, afterEach } from "vitest";
import { FetchBitbucketClient, BitbucketHttpError } from "./client";

function jsonRes(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("FetchBitbucketClient", () => {
  it("sends HTTP Basic auth and returns JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ username: "anmol" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchBitbucketClient({ email: "a@b.com", apiToken: "tok" });

    const res = await client.request<{ username: string }>("/user");
    expect(res.data.username).toBe("anmol");
    const call = fetchMock.mock.calls[0]!;
    expect(call[1].headers.Authorization).toBe(`Basic ${btoa("a@b.com:tok")}`);
  });

  it("paginates by following the body `next` url until exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({
          values: [{ slug: "r1" }],
          next: "https://api.bitbucket.org/2.0/repositories/acme?page=2",
        }),
      )
      .mockResolvedValueOnce(jsonRes({ values: [{ slug: "r2" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchBitbucketClient({ email: "a@b.com", apiToken: "tok" });

    const slugs: string[] = [];
    for await (const r of client.paginate<{ slug: string }>("/repositories/acme"))
      slugs.push(r.slug);

    expect(slugs).toEqual(["r1", "r2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 then succeeds (bounded, injected sleeper)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ error: "rate limited" }, { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchBitbucketClient({
      email: "a@b.com",
      apiToken: "tok",
      sleep: async () => {},
    });

    const res = await client.request<{ ok: boolean }>("/user");
    expect(res.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a BitbucketHttpError with the status on a non-retryable failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ error: "nope" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchBitbucketClient({ email: "a@b.com", apiToken: "bad" });

    await expect(client.request("/user")).rejects.toBeInstanceOf(BitbucketHttpError);
    await expect(client.request("/user")).rejects.toMatchObject({ status: 401 });
  });
});
