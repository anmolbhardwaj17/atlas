import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import type { Env } from "@atlas/config";
import { DiscordService } from "./discord.service";

/** A real Ed25519 keypair; public key as the 32-byte raw hex Discord would provide. */
function keypair(): { publicKeyHex: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { publicKeyHex: spki.subarray(spki.length - 32).toString("hex"), privateKey };
}
const KEYS = keypair();

const ENV = {
  DISCORD_APPLICATION_ID: "app-1",
  DISCORD_PUBLIC_KEY: KEYS.publicKeyHex,
  DISCORD_CLIENT_SECRET: "client-secret",
  WEB_ORIGIN: "https://app.atlas.dev",
  PUBLIC_API_URL: "https://api.atlas.dev",
} as unknown as Env;

function mockDb(orgForGuild: string | null) {
  const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("app_discord_org")) return { rows: [{ org: orgForGuild }] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
  };
  return { db, client };
}

const answer = {
  grounded: true,
  text: "**orders-db** has 3 dependents [N1].",
  confidence: "observed",
  citations: [{ number: 1, provenanceUrl: "/explore/n1", kind: "node" }],
  caveats: [],
  uncitedClaims: [],
  nodesConsidered: 5,
};
const ai = (a: unknown = answer) => ({ answerForIntegration: vi.fn().mockResolvedValue(a) });

function make(orgForGuild: string | null, answerObj: unknown = answer) {
  const { db, client } = mockDb(orgForGuild);
  const aiSvc = ai(answerObj);
  const svc = new DiscordService(db as never, ENV, aiSvc as never);
  return { svc, db, client, aiSvc };
}

/** Sign an interaction body the way Discord does (Ed25519 over timestamp + body). */
function signed(body: string, ts = "1700000000") {
  const sig = edSign(
    null,
    Buffer.concat([Buffer.from(ts), Buffer.from(body)]),
    KEYS.privateKey,
  ).toString("hex");
  return {
    rawBody: Buffer.from(body),
    headers: { "x-signature-timestamp": ts, "x-signature-ed25519": sig },
  };
}

describe("DiscordService — interaction", () => {
  it("rejects an interaction with a bad signature (401)", async () => {
    const { svc } = make("org-1");
    const req = signed('{"type":1}');
    req.headers["x-signature-ed25519"] = "00".repeat(64);
    expect((await svc.interaction(req.rawBody, req.headers)).status).toBe(401);
  });

  it("answers a PING with a PONG (endpoint verification)", async () => {
    const { svc } = make("org-1");
    const req = signed('{"type":1}');
    const r = await svc.interaction(req.rawBody, req.headers);
    expect(r.body).toEqual({ type: 1 });
  });

  it("prompts (ephemerally) when the command has no question", async () => {
    const { svc } = make("org-1");
    const req = signed('{"type":2,"guild_id":"G1","token":"tok","data":{"name":"atlas"}}');
    const r = await svc.interaction(req.rawBody, req.headers);
    expect(JSON.stringify(r.body)).toMatch(/what depends on/i);
    expect((r.body as { data: { flags: number } }).data.flags).toBe(64); // ephemeral
  });

  it("tells an unconnected guild to connect (ephemeral, no answer attempted)", async () => {
    const { svc, aiSvc } = make(null);
    const body =
      '{"type":2,"guild_id":"G9","token":"tok","data":{"name":"atlas","options":[{"name":"question","value":"hi"}]}}';
    const req = signed(body);
    const r = await svc.interaction(req.rawBody, req.headers);
    expect(JSON.stringify(r.body)).toMatch(/isn't connected|Integrations/i);
    expect(aiSvc.answerForIntegration).not.toHaveBeenCalled();
  });

  it("defers for a connected guild (type 5) so the LLM answer can arrive after the 3s window", async () => {
    const { svc } = make("org-1");
    const body =
      '{"type":2,"guild_id":"G1","token":"tok","data":{"name":"atlas","options":[{"name":"question","value":"what depends on orders-db"}]}}';
    const req = signed(body);
    const r = await svc.interaction(req.rawBody, req.headers);
    expect(r.body).toEqual({ type: 5 });
  });
});

describe("DiscordService — respond", () => {
  it("answers org-scoped and PATCHes the deferred message with a cited embed", async () => {
    const { svc, aiSvc } = make("org-1");
    const patch = vi
      .spyOn(
        svc as never as { httpPatchJson: (u: string, b: unknown) => Promise<void> },
        "httpPatchJson",
      )
      .mockResolvedValue(undefined);

    await svc.respond("org-1", "what depends on orders-db?", "interaction-token-abc");

    expect(aiSvc.answerForIntegration).toHaveBeenCalledWith("org-1", "what depends on orders-db?");
    const [url, payload] = patch.mock.calls[0] as [
      string,
      { embeds: Array<{ description: string }> },
    ];
    expect(url).toBe(
      "https://discord.com/api/v10/webhooks/app-1/interaction-token-abc/messages/@original",
    );
    expect(payload.embeds[0]?.description).toContain("**orders-db** has 3 dependents");
    expect(JSON.stringify(payload)).not.toContain("[N1]");
  });

  it("PATCHes an error message (never throws) when answering fails", async () => {
    const { svc, aiSvc } = make("org-1");
    aiSvc.answerForIntegration.mockRejectedValue(new Error("boom"));
    const patch = vi
      .spyOn(
        svc as never as { httpPatchJson: (u: string, b: unknown) => Promise<void> },
        "httpPatchJson",
      )
      .mockResolvedValue(undefined);
    await expect(svc.respond("org-1", "q", "tok")).resolves.toBeUndefined();
    expect(JSON.stringify(patch.mock.calls[0]?.[1])).toMatch(/error/i);
  });
});

describe("DiscordService — OAuth install", () => {
  it("builds an install URL with the bot + commands scopes and a signed state", () => {
    const { svc } = make(null);
    const url = new URL(svc.buildInstallUrl("org-1", "user-1") as string);
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("scope")).toContain("applications.commands");
    expect(svc.verifyInstallState(url.searchParams.get("state") as string)?.orgId).toBe("org-1");
  });

  it("binds the guild to the org on success", async () => {
    const ORG = "11111111-1111-1111-1111-111111111111";
    const { svc, client } = make(null);
    vi.spyOn(
      svc as never as { oauthExchange: (c: string) => Promise<unknown> },
      "oauthExchange",
    ).mockResolvedValue({
      guild: { id: "G1", name: "Acme" },
    });
    const r = await svc.handleOAuthCallback("code", svc.signInstallState(ORG, "user-1"));
    expect(r).toEqual({ ok: true, guildName: "Acme" });
    const sql = client.query.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("INSERT INTO discord_installations");
  });

  it("refuses a guild already bound to a DIFFERENT org (R8)", async () => {
    const { svc } = make("org-OTHER");
    vi.spyOn(
      svc as never as { oauthExchange: (c: string) => Promise<unknown> },
      "oauthExchange",
    ).mockResolvedValue({
      guild: { id: "G1", name: "Acme" },
    });
    const r = await svc.handleOAuthCallback("code", svc.signInstallState("org-1", "user-1"));
    expect(r).toEqual({ ok: false, error: "already_connected_to_another_org" });
  });

  it("refuses an invalid state", async () => {
    const { svc } = make(null);
    expect(await svc.handleOAuthCallback("code", "bad")).toEqual({
      ok: false,
      error: "invalid_state",
    });
  });
});
