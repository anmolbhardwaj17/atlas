import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { Env } from "@atlas/config";
import { SlackService } from "./slack.service";

const SECRET = "8f742c4d0e0a1b2c3d4e5f6a7b8c9d0e";

const ENV = {
  SLACK_SIGNING_SECRET: SECRET,
  SLACK_CLIENT_ID: "client-id",
  SLACK_CLIENT_SECRET: "client-secret",
  WEB_ORIGIN: "https://app.atlas.dev",
  PUBLIC_API_URL: "https://api.atlas.dev",
} as unknown as Env;

/** A pool that answers the app_slack_org resolver and captures withOrgScope client queries. */
function mockDb(orgForTeam: string | null) {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("app_slack_org")) return { rows: [{ org: orgForTeam }] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
  };
  return { db, client };
}

const secrets = () => ({
  put: vi.fn().mockResolvedValue("secret-ref-1"),
  get: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
});

const answer = {
  grounded: true,
  text: "**orders-db** has 3 dependents [N1].",
  confidence: "observed",
  citations: [
    {
      number: 1,
      provenanceUrl: "/explore/n1",
      kind: "node",
      marker: "[N1]",
      confidence: "observed",
    },
  ],
  caveats: [],
  uncitedClaims: [],
  nodesConsidered: 5,
};
const ai = (a: unknown = answer) => ({ answerForIntegration: vi.fn().mockResolvedValue(a) });

function make(orgForTeam: string | null, answerObj: unknown = answer) {
  const { db, client } = mockDb(orgForTeam);
  const sec = secrets();
  const aiSvc = ai(answerObj);
  const svc = new SlackService(db as never, ENV, sec as never, aiSvc as never);
  return { svc, db, client, sec, aiSvc };
}

/** Build a signed slash-command request (raw urlencoded body + Slack signature headers). */
function signedCommand(body: string, nowSec = Math.floor(Date.now() / 1000)) {
  const ts = String(nowSec);
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;
  return {
    rawBody: Buffer.from(body),
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
  };
}

describe("SlackService — install state", () => {
  it("signs and verifies a round-trip, carrying org + user", () => {
    const { svc } = make(null);
    const state = svc.signInstallState("org-1", "user-1");
    expect(svc.verifyInstallState(state)).toEqual({ orgId: "org-1", userId: "user-1" });
  });

  it("rejects a tampered state", () => {
    const { svc } = make(null);
    const state = svc.signInstallState("org-1", "user-1");
    expect(svc.verifyInstallState(state.slice(0, -2) + "xy")).toBeNull();
  });

  it("rejects an expired state (>10 min old)", () => {
    const { svc } = make(null);
    const state = svc.signInstallState("org-1", "user-1", 1_000_000);
    expect(svc.verifyInstallState(state, 1_000_000 + 11 * 60_000)).toBeNull();
  });
});

describe("SlackService — slash command", () => {
  it("rejects a request whose signature doesn't verify (401)", async () => {
    const { svc } = make("org-1");
    const req = signedCommand("team_id=T1&text=hi&response_url=https://hooks.slack.com/x");
    req.headers["x-slack-signature"] = "v0=deadbeef";
    expect((await svc.command(req.rawBody, req.headers)).status).toBe(401);
  });

  it("prompts for input when the command has no text", async () => {
    const { svc } = make("org-1");
    const req = signedCommand("team_id=T1&text=&response_url=https://hooks.slack.com/x");
    const r = await svc.command(req.rawBody, req.headers);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toMatch(/what depends on/i);
  });

  it("tells an unconnected workspace to connect (no answer attempted)", async () => {
    const { svc, aiSvc } = make(null); // app_slack_org → null
    const req = signedCommand("team_id=T9&text=hello&response_url=https://hooks.slack.com/x");
    const r = await svc.command(req.rawBody, req.headers);
    expect(JSON.stringify(r.body)).toMatch(/isn't connected|Integrations/i);
    expect(aiSvc.answerForIntegration).not.toHaveBeenCalled();
  });

  it("acks immediately for a connected workspace", async () => {
    const { svc } = make("org-1");
    const req = signedCommand(
      "team_id=T1&text=what+depends+on+orders-db&response_url=https://hooks.slack.com/x",
    );
    const r = await svc.command(req.rawBody, req.headers);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toMatch(/looking into it/i);
  });
});

describe("SlackService — respond", () => {
  it("answers org-scoped and posts an in_channel, cited Block Kit message to response_url", async () => {
    const { svc, aiSvc } = make("org-1");
    const post = vi
      .spyOn(
        svc as never as { httpPostJson: (u: string, b: unknown) => Promise<void> },
        "httpPostJson",
      )
      .mockResolvedValue(undefined);

    await svc.respond("org-1", "what depends on orders-db?", "https://hooks.slack.com/actions/x");

    expect(aiSvc.answerForIntegration).toHaveBeenCalledWith("org-1", "what depends on orders-db?");
    expect(post).toHaveBeenCalledTimes(1);
    const [url, payload] = post.mock.calls[0] as [
      string,
      { response_type: string; blocks: unknown[] },
    ];
    expect(url).toContain("hooks.slack.com");
    expect(payload.response_type).toBe("in_channel");
    const text = JSON.stringify(payload.blocks);
    expect(text).toContain("*orders-db* has 3 dependents"); // mrkdwn-converted, marker stripped
    expect(text).not.toContain("[N1]");
    expect(text).toContain("Observed"); // confidence footer
  });

  it("posts an error message (never throws) when answering fails", async () => {
    const { svc, aiSvc } = make("org-1");
    aiSvc.answerForIntegration.mockRejectedValue(new Error("boom"));
    const post = vi
      .spyOn(
        svc as never as { httpPostJson: (u: string, b: unknown) => Promise<void> },
        "httpPostJson",
      )
      .mockResolvedValue(undefined);

    await expect(
      svc.respond("org-1", "q", "https://hooks.slack.com/actions/x"),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(post.mock.calls[0]?.[1])).toMatch(/error/i);
  });
});

describe("SlackService — OAuth install", () => {
  it("refuses an invalid state (CSRF / tampering)", async () => {
    const { svc } = make(null);
    expect(await svc.handleOAuthCallback("code", "not-a-valid-state")).toEqual({
      ok: false,
      error: "invalid_state",
    });
  });

  it("binds the workspace to the org on success (stores token, upserts install)", async () => {
    const ORG = "11111111-1111-1111-1111-111111111111"; // withOrgScope requires a real UUID
    const { svc, sec, client } = make(null); // team not yet bound
    vi.spyOn(
      svc as never as { oauthExchange: (c: string) => Promise<unknown> },
      "oauthExchange",
    ).mockResolvedValue({
      ok: true,
      team: { id: "T1", name: "Acme" },
      access_token: "xoxb-123",
      bot_user_id: "U1",
      scope: "commands",
    });
    const state = svc.signInstallState(ORG, "user-1");

    const r = await svc.handleOAuthCallback("code", state);

    expect(r).toEqual({ ok: true, teamName: "Acme" });
    expect(sec.put).toHaveBeenCalledWith(ORG, { botToken: "xoxb-123" }); // encrypted, not stored raw
    const insert = client.query.mock.calls.map((c) => String(c[0])).join("\n");
    expect(insert).toContain("INSERT INTO slack_installations");
  });

  it("builds an install URL carrying client_id, the commands scope, and a signed state", () => {
    const { svc } = make(null);
    const url = svc.buildInstallUrl("org-1", "user-1");
    expect(url).toBeTruthy();
    const u = new URL(url as string);
    expect(u.searchParams.get("client_id")).toBe("client-id");
    expect(u.searchParams.get("scope")).toBe("commands");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.atlas.dev/slack/oauth/callback");
    // The state must verify back to the same org (round-trip through the signer).
    expect(svc.verifyInstallState(u.searchParams.get("state") as string)?.orgId).toBe("org-1");
  });

  it("disconnect drops the install row AND shreds the stored bot token", async () => {
    const ORG = "22222222-2222-2222-2222-222222222222";
    const { svc, sec, client } = make(null);
    client.query.mockResolvedValue({ rows: [{ bot_secret_ref: "secret-ref-9" }] });

    const r = await svc.uninstall(ORG);
    expect(r).toEqual({ disconnected: true });
    const sql = client.query.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("DELETE FROM slack_installations");
    expect(sec.delete).toHaveBeenCalledWith("secret-ref-9");
  });

  it("refuses to re-point a workspace already bound to a DIFFERENT org (R8)", async () => {
    const { svc, sec } = make("org-OTHER"); // team already bound elsewhere
    vi.spyOn(
      svc as never as { oauthExchange: (c: string) => Promise<unknown> },
      "oauthExchange",
    ).mockResolvedValue({
      ok: true,
      team: { id: "T1", name: "Acme" },
      access_token: "xoxb-123",
    });
    const state = svc.signInstallState("org-1", "user-1");

    const r = await svc.handleOAuthCallback("code", state);
    expect(r).toEqual({ ok: false, error: "already_connected_to_another_org" });
    expect(sec.put).not.toHaveBeenCalled(); // never even stored a token
  });
});
