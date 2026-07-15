import { describe, it, expect } from "vitest";
import { validateChannelUrl } from "./notification.service";

/**
 * Webhook-URL validation is an SSRF boundary: a channel URL is fetched from our egress, so a
 * bypassable validator lets an org admin point us at cloud metadata / internal hosts. These assert
 * the host is parsed (not regex-matched over the whole string) for all three kinds.
 */
describe("validateChannelUrl (SSRF-safe webhook validation)", () => {
  it("rejects host-spoofing / SSRF attempts for Teams", () => {
    for (const u of [
      "https://169.254.169.254/.webhook.office.com/x", // metadata IP as host, provider domain in path
      "https://evil.com/.webhook.office.com/x", // attacker host, provider domain in path
      "https://169.254.169.254@acme.webhook.office.com/x", // userinfo trick (real host after @)
      "http://acme.webhook.office.com/x", // not https
      "https://.webhook.office.com/x", // empty leading label
      "not a url",
    ]) {
      expect(validateChannelUrl("msteams", u), u).toBe(false);
    }
  });

  it("rejects host-spoofing for Slack and Discord", () => {
    expect(validateChannelUrl("slack", "https://hooks.slack.com.evil.com/services/x")).toBe(false);
    expect(validateChannelUrl("slack", "https://evil.com/services/x")).toBe(false);
    expect(validateChannelUrl("discord", "https://evil.com/api/webhooks/x")).toBe(false);
    expect(validateChannelUrl("discord", "https://discord.com.evil.com/api/webhooks/x")).toBe(
      false,
    );
  });

  it("accepts genuine provider webhook URLs", () => {
    expect(
      validateChannelUrl(
        "msteams",
        "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/d",
      ),
    ).toBe(true);
    expect(validateChannelUrl("slack", "https://hooks.slack.com/services/T00/B00/xyz")).toBe(true);
    expect(validateChannelUrl("discord", "https://discord.com/api/webhooks/123/abc")).toBe(true);
    expect(validateChannelUrl("discord", "https://ptb.discord.com/api/webhooks/123/abc")).toBe(
      true,
    );
  });
});
