import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@atlas/config";
import { ENV } from "./tokens";

export interface InviteEmail {
  to: string;
  orgName: string;
  role: string;
  acceptUrl: string;
}
export interface WelcomeEmail {
  to: string;
  name: string | null;
}

/**
 * Transactional email via Resend (docs/12 §6.2). Behind a tiny interface so SES/others can swap
 * in later (a fetch to Resend's REST API — no SDK dependency). When RESEND_API_KEY is unset it
 * logs instead of sending, so flows still work in dev; and a send failure is NON-FATAL (logged,
 * never thrown) so it can never break the request that triggered it. Every email shares one
 * branded layout (`emailShell`) so they look consistent + modern.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string;
  private readonly webOrigin: string;

  constructor(@Inject(ENV) env: Env) {
    this.apiKey = env.RESEND_API_KEY;
    this.from = env.EMAIL_FROM;
    this.webOrigin = env.WEB_ORIGIN;
  }

  async sendInvite(msg: InviteEmail): Promise<void> {
    const html = emailShell({
      heading: `You're invited to ${escapeHtml(msg.orgName)}`,
      body: `You've been invited to join <b>${escapeHtml(msg.orgName)}</b> on Atlas as <b>${escapeHtml(
        msg.role,
      )}</b> — the engineering-intelligence platform that maps your whole estate and answers questions about it.`,
      cta: { label: "Accept invitation", url: msg.acceptUrl },
      footnote: `Sign in with <b>${escapeHtml(
        msg.to,
      )}</b> to accept. This link expires in 7 days. If you didn't expect this, you can ignore it.`,
    });
    await this.send(msg.to, `You're invited to join ${msg.orgName} on Atlas`, html);
  }

  async sendWelcome(msg: WelcomeEmail): Promise<void> {
    const hi = msg.name
      ? `Welcome, ${escapeHtml(msg.name.split(" ")[0] ?? msg.name)}`
      : "Welcome to Atlas";
    const html = emailShell({
      heading: hi,
      body: `Atlas builds a live, cited map of everything you run — your cloud, your code, and how they connect — so you can understand your estate, spot risks, and ask it anything.`,
      steps: [
        {
          n: "1",
          t: "Connect a source",
          d: "Link AWS, GitHub, or Bitbucket (read-only) and Atlas starts building your graph.",
        },
        {
          n: "2",
          t: "Explore the map",
          d: "See your services, dependencies, and what's healthy at a glance.",
        },
        {
          n: "3",
          t: "Ask Atlas",
          d: "“What depends on this database?” — grounded, cited answers.",
        },
      ],
      cta: { label: "Open Atlas", url: `${this.webOrigin}/dashboard` },
      footnote: `Questions? Just reply to this email. We're glad you're here.`,
    });
    await this.send(msg.to, "Welcome to Atlas", html);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`RESEND_API_KEY unset - email "${subject}" to ${to} NOT sent.`);
      return;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to, subject, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.error(
          `Resend "${subject}" to ${to} failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return;
      }
      this.logger.log(`Email "${subject}" sent to ${to}.`);
    } catch (e) {
      this.logger.error(`Email "${subject}" to ${to} errored: ${(e as Error).message}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Shell {
  heading: string;
  body: string;
  cta: { label: string; url: string };
  steps?: Array<{ n: string; t: string; d: string }>;
  footnote?: string;
}

/**
 * One branded, email-client-safe layout (tables + inline styles): a light card on a neutral
 * ground, the Atlas mark + wordmark, a heading, body, optional numbered steps, a CTA button, and a
 * muted footnote. The "mark" is a CSS green rounded square (no external/data-URI image, which email
 * clients block) that approximates the Atlas AI sphere and renders everywhere.
 */
function emailShell(s: Shell): string {
  const steps = (s.steps ?? [])
    .map(
      (st) => `<tr><td style="padding:10px 0;border-top:1px solid #eceeec">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" width="30" style="font-size:13px;font-weight:700;color:#0f9d63">${st.n}</td>
          <td><div style="font-size:14px;font-weight:600;color:#141a17">${st.t}</div>
              <div style="font-size:13px;color:#5c6b64;line-height:1.5;margin-top:2px">${st.d}</div></td>
        </tr></table></td></tr>`,
    )
    .join("");
  const stepsBlock = steps
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px">${steps}</table>`
    : "";
  const footnote = s.footnote
    ? `<div style="font-size:12px;color:#8a938d;line-height:1.55;margin-top:24px">${s.footnote}</div>`
    : "";
  return `<!doctype html><html><head><meta name="color-scheme" content="light"></head>
  <body style="margin:0;background:#f3f5f3;padding:32px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e9e6;border-radius:16px;overflow:hidden">
      <tr><td style="padding:28px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="30" valign="middle">
            <div style="width:26px;height:26px;border-radius:8px;background:#0f9d63;background-image:radial-gradient(120% 120% at 30% 25%,#3ddc9a,#0b7a4c)"></div>
          </td>
          <td valign="middle" style="padding-left:10px;font-size:17px;font-weight:700;color:#141a17;letter-spacing:-.01em">Atlas</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 32px 32px">
        <div style="font-size:21px;font-weight:700;color:#141a17;letter-spacing:-.02em;margin-bottom:10px">${s.heading}</div>
        <div style="font-size:15px;line-height:1.6;color:#3b4641">${s.body}</div>
        ${stepsBlock}
        <a href="${s.cta.url}" style="display:inline-block;margin-top:22px;background:#0f9d63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">${s.cta.label}</a>
        ${footnote}
      </td></tr>
    </table>
    <div style="font-size:11px;color:#9aa39d;margin-top:18px">Atlas · The knowledge graph is the product.</div>
  </td></tr></table>
  </body></html>`;
}
