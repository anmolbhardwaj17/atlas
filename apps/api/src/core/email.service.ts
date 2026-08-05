import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@atlas/config";
import { ENV } from "./tokens";
import { fetchWithTimeout } from "../common/fetch-timeout";

export interface InviteEmail {
  to: string;
  orgName: string;
  role: string;
  acceptUrl: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  expiresAt?: Date | string | undefined;
}
export interface WelcomeEmail {
  to: string;
  name: string | null;
}
export interface IncidentAlertEmail {
  to: string;
  orgName: string;
  nodeName: string;
  /** "unhealthy" | "degraded". */
  state: string;
  /** The deterministic likely-cause headline (a full sentence). */
  cause: string;
  warRoomUrl: string;
}
export interface WeeklyDigestEmail {
  to: string;
  orgName: string;
  postureScore: number | null;
  resources: number;
  counts: { high: number; medium: number; low: number };
  /** Top findings to surface (already ranked; typically 5-6). */
  findings: Array<{ severity: "high" | "medium" | "low"; title: string; url: string }>;
  insightsUrl: string;
  unsubscribeUrl: string;
}

const SEV_HEX: Record<"high" | "medium" | "low", string> = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#eab308",
};

/**
 * Transactional email via Resend (docs/12 §6.2). Behind a tiny interface so SES/others can swap in
 * later (a fetch to Resend's REST API — no SDK dependency). When RESEND_API_KEY is unset it logs
 * instead of sending, so flows still work in dev; a send failure is NON-FATAL and reported as
 * `false` so callers can fall back (copy-link) without breaking the request that triggered it.
 *
 * The HTML is production-grade and email-client-safe: table layout, fully inlined styles, a hidden
 * preheader, a bulletproof VML button for Outlook, `@media (prefers-color-scheme: dark)` support,
 * and a mobile breakpoint. Every message shares one branded shell (`emailShell`).
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

  /** Returns whether the email was actually delivered (so callers can tell the user honestly, and
   *  fall back to the copy-link only when it truly wasn't sent). */
  async sendInvite(msg: InviteEmail): Promise<boolean> {
    const inviter = msg.inviterName?.trim() || msg.inviterEmail?.trim() || null;
    const meta: MetaRow[] = [
      { label: "Organization", value: msg.orgName },
      { label: "Your role", value: msg.role },
    ];
    if (inviter) meta.push({ label: "Invited by", value: inviter });
    meta.push({ label: "Invitation expires", value: formatExpiry(msg.expiresAt) });

    const html = emailShell({
      preheader: `${inviter ? `${inviter} invited you` : "You've been invited"} to join ${msg.orgName} on Atlas.`,
      heading: `You're invited to ${escapeHtml(msg.orgName)}`,
      intro: `${
        inviter
          ? `<b style="color:inherit">${escapeHtml(inviter)}</b> has invited you to join`
          : "You've been invited to join"
      } <b style="color:inherit">${escapeHtml(msg.orgName)}</b> on <b style="color:inherit">Atlas</b> — the engineering-intelligence platform that maps a company's entire cloud and codebase into one live, cited knowledge graph you can explore, search, and ask.`,
      meta,
      cta: { label: "Accept invitation", url: msg.acceptUrl, width: 210 },
      linkFallback: msg.acceptUrl,
      security: `Sign in with <b style="color:inherit">${escapeHtml(
        msg.to,
      )}</b> to accept — the invitation is tied to this address. If you weren't expecting this, you can safely ignore this email; nothing happens until you accept.`,
    });
    return this.send(msg.to, `You're invited to join ${msg.orgName} on Atlas`, html);
  }

  async sendWelcome(msg: WelcomeEmail): Promise<boolean> {
    const first = msg.name ? (msg.name.split(" ")[0] ?? msg.name) : null;
    const html = emailShell({
      preheader:
        "Your Atlas organization is ready — connect a source and see your whole system map.",
      heading: first ? `Welcome, ${escapeHtml(first)}` : "Welcome to Atlas",
      intro: `Atlas builds a live, cited map of everything your team runs and ships — your cloud, your code, and how they connect — so you can understand your estate at a glance, spot risks early, and ask it anything in plain English.`,
      steps: [
        {
          n: "1",
          t: "Connect a source",
          d: "Link AWS, GitHub, or Bitbucket (read-only). Atlas starts crawling and building your graph within minutes.",
        },
        {
          n: "2",
          t: "Explore the map",
          d: "See every service, database, and dependency — what's healthy, what changed, and what depends on what.",
        },
        {
          n: "3",
          t: "Ask Atlas anything",
          d: "“What breaks if this database goes down?” — get grounded answers, every claim cited to a real resource.",
        },
      ],
      cta: { label: "Open Atlas", url: `${this.webOrigin}/dashboard`, width: 170 },
      security: `You're receiving this because an account was created for you on Atlas. Questions? Just reply — a real person reads it.`,
    });
    return this.send(msg.to, "Welcome to Atlas", html);
  }

  /** Immediate incident alert (docs/plans/proactive-incidents.md): a healthy prod resource just broke.
   *  Carries the deterministic likely-cause + a one-click link to the War Room's live diagnosis. */
  async sendIncidentAlert(msg: IncidentAlertEmail): Promise<boolean> {
    const meta: MetaRow[] = [
      { label: "Resource", value: msg.nodeName },
      { label: "Status", value: msg.state },
      { label: "Likely cause", value: msg.cause },
    ];
    const html = emailShell({
      preheader: `${msg.nodeName} went ${msg.state} — ${msg.cause}`,
      heading: `${escapeHtml(msg.nodeName)} went ${escapeHtml(msg.state)}`,
      intro: `Atlas detected that <b style="color:inherit">${escapeHtml(
        msg.nodeName,
      )}</b> in <b style="color:inherit">${escapeHtml(
        msg.orgName,
      )}</b> just went <b style="color:inherit">${escapeHtml(
        msg.state,
      )}</b>. ${escapeHtml(msg.cause)} Open the War Room for the full, cited trace to the root cause.`,
      meta,
      cta: { label: "Open the War Room", url: msg.warRoomUrl, width: 200 },
      security: `You're receiving this because Atlas is set to alert on incidents for <b style="color:inherit">${escapeHtml(
        msg.orgName,
      )}</b>. An admin can change this in Settings → Incident alerts.`,
    });
    return this.send(msg.to, `${msg.nodeName} went ${msg.state} — ${msg.orgName}`, html);
  }

  /** Weekly posture digest (docs/plans/compliance + #44): open findings by severity, the top items
   *  each linking to their evidence, and posture. Honest — "all clear" is a first-class state, not a
   *  fabricated problem. Every digest carries a one-click unsubscribe. */
  async sendWeeklyDigest(msg: WeeklyDigestEmail): Promise<boolean> {
    const total = msg.counts.high + msg.counts.medium + msg.counts.low;
    const meta: MetaRow[] = [{ label: "Resources mapped", value: String(msg.resources) }];
    meta.push({
      label: "Open findings",
      value:
        total > 0
          ? `${total}  ·  ${msg.counts.high} high, ${msg.counts.medium} med, ${msg.counts.low} low`
          : "none",
    });
    if (msg.postureScore !== null)
      meta.push({ label: "Security posture", value: `${msg.postureScore} / 100` });

    const list = msg.findings.slice(0, 6).map((f) => ({
      dot: SEV_HEX[f.severity],
      title: f.title,
      sub: f.severity.toUpperCase(),
      url: f.url,
    }));
    const intro =
      total > 0
        ? `Here's what Atlas is flagging across <b style="color:inherit">${escapeHtml(
            msg.orgName,
          )}</b> this week. The top items are below - open Atlas for the full list, the cited evidence, and how to fix each.`
        : `Good news - Atlas isn't flagging anything to act on across <b style="color:inherit">${escapeHtml(
            msg.orgName,
          )}</b> right now. Your estate is mapped and clean this week.`;

    const html = emailShell({
      preheader:
        total > 0
          ? `${total} open findings across ${msg.orgName} - ${msg.counts.high} high-severity.`
          : `All clear across ${msg.orgName} this week.`,
      heading: "Your weekly Atlas digest",
      intro,
      meta,
      ...(list.length > 0 ? { list } : {}),
      cta: { label: "Open Atlas", url: msg.insightsUrl, width: 170 },
      security: `You're receiving Atlas's weekly digest for <b style="color:inherit">${escapeHtml(
        msg.orgName,
      )}</b>. <a href="${msg.unsubscribeUrl}" class="link" style="color:#8a938d;text-decoration:underline">Unsubscribe from the weekly digest</a>.`,
    });
    return this.send(msg.to, `Your weekly Atlas digest - ${msg.orgName}`, html);
  }

  /** Returns true only if the provider accepted the message. Never throws — a failure is logged and
   *  reported as `false` so the caller can fall back (e.g. surface a copy-link) without breaking. */
  private async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn(`RESEND_API_KEY unset - email "${subject}" to ${maskEmail(to)} NOT sent.`);
      return false;
    }
    try {
      const res = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to, subject, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.error(
          `Resend "${subject}" to ${maskEmail(to)} failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return false;
      }
      this.logger.log(`Email "${subject}" sent to ${maskEmail(to)}.`);
      return true;
    } catch (e) {
      this.logger.error(`Email "${subject}" to ${maskEmail(to)} errored: ${(e as Error).message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = {
  name: "Atlas",
  tagline: "The knowledge graph is the product.",
  green: "#0f9d63",
  greenTop: "#17a86d",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface MetaRow {
  label: string;
  value: string;
}
interface Shell {
  preheader: string;
  heading: string;
  /** Trusted HTML (built above with escaped interpolations). */
  intro: string;
  meta?: MetaRow[];
  steps?: Array<{ n: string; t: string; d: string }>;
  /** A list of items with a colored severity dot (the weekly digest's findings). */
  list?: Array<{ dot: string; title: string; sub?: string; url?: string }>;
  cta: { label: string; url: string; width: number };
  /** A raw URL shown as a selectable fallback ("or copy this link"). */
  linkFallback?: string;
  /** Trusted HTML footnote (security/context). */
  security?: string;
}

/** Mask an email for logs — keep the first local char + the domain (`f***@bar.com`), so a log line
 *  is debuggable without spilling the full address (PII minimization in logs). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiry(v: Date | string | undefined): string {
  if (!v) return "in 7 days";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "in 7 days";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Bulletproof CTA: a VML round-rect for Outlook + a styled anchor everywhere else. */
function ctaButton(label: string, url: string, width: number): string {
  const safe = escapeHtml(label);
  return `
  <!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:${width}px;" arcsize="22%" strokecolor="${BRAND.green}" fillcolor="${BRAND.green}">
    <w:anchorlock/>
    <center style="color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;">${safe}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-->
  <a href="${url}" target="_blank" class="btn" style="display:inline-block;background:${BRAND.green};background-image:linear-gradient(180deg,${BRAND.greenTop},${BRAND.green});color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:46px;height:46px;padding:0 30px;border-radius:11px;font-family:${FONT};box-shadow:0 2px 6px rgba(15,157,99,0.35)">${safe}</a>
  <!--<![endif]-->`;
}

function metaTable(rows: MetaRow[]): string {
  const body = rows
    .map(
      (r, i) => `
    <tr>
      <td class="meta-k" style="padding:${i === 0 ? "0" : "9px"} 0 9px 0;${
        i === 0 ? "" : "border-top:1px solid #eef1ef;"
      }font-size:13px;color:#66756e;font-family:${FONT};white-space:nowrap" valign="top" width="42%">${escapeHtml(
        r.label,
      )}</td>
      <td class="meta-v" style="padding:${i === 0 ? "0" : "9px"} 0 9px 0;${
        i === 0 ? "" : "border-top:1px solid #eef1ef;"
      }font-size:13px;font-weight:600;color:#141a17;font-family:${FONT};text-align:right" valign="top">${escapeHtml(
        r.value,
      )}</td>
    </tr>`,
    )
    .join("");
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="meta-box" style="margin:24px 0 4px;background:#f7f9f8;border:1px solid #e9edeb;border-radius:12px">
    <tr><td style="padding:16px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
    </td></tr>
  </table>`;
}

function findingsList(
  items: Array<{ dot: string; title: string; sub?: string; url?: string }>,
): string {
  const rows = items
    .map((it, i) => {
      const title = it.url
        ? `<a href="${it.url}" class="link text-strong" style="color:#141a17;text-decoration:none;font-weight:600">${escapeHtml(it.title)}</a>`
        : `<span class="text-strong" style="color:#141a17;font-weight:600">${escapeHtml(it.title)}</span>`;
      const sub = it.sub
        ? `<span style="font-size:11px;font-weight:700;letter-spacing:.04em;color:${it.dot};font-family:${FONT}">${escapeHtml(it.sub)}</span>`
        : "";
      return `
      <tr>
        <td valign="top" width="16" style="padding:${i === 0 ? "0" : "12px"} 0 12px 0;${i === 0 ? "" : "border-top:1px solid #eef1ef;"}">
          <div style="width:8px;height:8px;border-radius:9px;background:${it.dot};margin-top:5px"></div>
        </td>
        <td valign="top" style="padding:${i === 0 ? "0" : "12px"} 0 12px 10px;${i === 0 ? "" : "border-top:1px solid #eef1ef;"}font-size:14px;line-height:1.5;font-family:${FONT}" class="text-body">${title}</td>
        <td valign="top" align="right" style="padding:${i === 0 ? "0" : "12px"} 0 12px 10px;${i === 0 ? "" : "border-top:1px solid #eef1ef;"}white-space:nowrap">${sub}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px">${rows}</table>`;
}

function stepsTable(steps: Array<{ n: string; t: string; d: string }>): string {
  const rows = steps
    .map(
      (st, i) => `
    <tr>
      <td valign="top" width="40" style="padding:${i === 0 ? "2px" : "16px"} 0 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="step-n" align="center" valign="middle" width="26" height="26" style="width:26px;height:26px;background:#eafaf2;border-radius:8px;font-size:13px;font-weight:700;color:${BRAND.green};font-family:${FONT}">${st.n}</td></tr></table>
      </td>
      <td valign="top" style="padding:${i === 0 ? "0" : "16px"} 0 0 12px">
        <div class="text-strong" style="font-size:15px;font-weight:600;color:#141a17;font-family:${FONT}">${escapeHtml(
          st.t,
        )}</div>
        <div class="text-body" style="font-size:14px;color:#5c6b64;line-height:1.55;margin-top:3px;font-family:${FONT}">${escapeHtml(
          st.d,
        )}</div>
      </td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 4px">${rows}</table>`;
}

/**
 * One branded, client-safe layout. Light card on a neutral ground with a full dark-mode variant.
 * The brand "mark" is a CSS green rounded square (no external/data-URI image, which many clients
 * block) approximating the Atlas AI sphere — it renders everywhere.
 */
function emailShell(s: Shell): string {
  const year = new Date().getFullYear();
  const meta = s.meta?.length ? metaTable(s.meta) : "";
  const steps = s.steps?.length ? stepsTable(s.steps) : "";
  const list = s.list?.length ? findingsList(s.list) : "";
  const linkFallback = s.linkFallback
    ? `<div class="text-muted" style="font-size:12px;color:#8a938d;line-height:1.5;margin-top:20px;font-family:${FONT}">Or paste this link into your browser:<br>
       <a href="${s.linkFallback}" class="link" style="color:${BRAND.green};word-break:break-all;text-decoration:none">${escapeHtml(
         s.linkFallback,
       )}</a></div>`
    : "";
  const security = s.security
    ? `<div class="text-muted" style="font-size:12px;color:#8a938d;line-height:1.6;margin-top:26px;padding-top:20px;border-top:1px solid #eef1ef;font-family:${FONT}">${s.security}</div>`
    : "";

  // Preheader repeated with zero-width joiners so the inbox preview isn't padded with body text.
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f3f5f3;opacity:0">${escapeHtml(
    s.preheader,
  )}${"&nbsp;&zwnj;".repeat(60)}</div>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>${escapeHtml(s.heading)}</title>
  <style>
    body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse!important}
    a{text-decoration:none}
    img{border:0;line-height:100%;outline:none;-ms-interpolation-mode:bicubic}
    @media only screen and (max-width:620px){
      .container{width:100%!important}
      .px{padding-left:24px!important;padding-right:24px!important}
      .pt{padding-top:28px!important}
      .h1{font-size:22px!important}
    }
    @media (prefers-color-scheme:dark){
      .bg-page{background:#0a0c0b!important}
      .card{background:#121614!important;border-color:#222826!important}
      .h1,.text-strong,.meta-v{color:#f1f4f2!important}
      .text-body{color:#c2cbc6!important}
      .text-muted,.meta-k{color:#8a938d!important}
      .divider,.card td[style*="border-top"]{border-color:#222826!important}
      .meta-box{background:#0e1210!important;border-color:#222826!important}
      .step-n{background:#0f2a1f!important}
      .foot{color:#6b746e!important}
    }
  </style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:#eef1ef;font-family:${FONT}">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-page" style="background:#eef1ef">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="container" style="width:600px;max-width:600px">

        <!-- Header -->
        <tr><td class="px pt" style="padding:4px 12px 18px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td valign="middle" width="30">
              <div style="width:28px;height:28px;border-radius:8px;background:${BRAND.green};background-image:radial-gradient(120% 120% at 30% 22%,#3ddc9a,#0b7a4c)"></div>
            </td>
            <td valign="middle" style="padding-left:10px;font-size:18px;font-weight:700;color:#141a17;letter-spacing:-.01em;font-family:${FONT}" class="text-strong">Atlas</td>
          </tr></table>
        </td></tr>

        <!-- Card -->
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff;border:1px solid #e4e9e6;border-radius:16px">
            <tr><td class="px" style="padding:36px 40px 40px">
              <h1 class="h1 text-strong" style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:#141a17;letter-spacing:-.02em;font-family:${FONT}">${s.heading}</h1>
              <div class="text-body" style="font-size:15px;line-height:1.65;color:#3b4641;font-family:${FONT}">${s.intro}</div>
              ${meta}
              ${list}
              ${steps}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td>
                ${ctaButton(s.cta.label, s.cta.url, s.cta.width)}
              </td></tr></table>
              ${linkFallback}
              ${security}
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td class="px" style="padding:22px 40px 8px" align="center">
          <div class="foot" style="font-size:12px;color:#9aa39d;line-height:1.6;font-family:${FONT}">
            <b style="color:inherit">${BRAND.name}</b> — ${BRAND.tagline}<br>
            © ${year} Atlas · You received this email because of activity on your Atlas account.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
