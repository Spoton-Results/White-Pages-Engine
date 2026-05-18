/**
 * lead-notify.ts
 * Sends lead notification emails to:
 *   1. The agency owner who manages the website's account
 *   2. The client (account primary contact email)
 *
 * Transport priority:
 *   1. SendGrid HTTP API  — set SENDGRID_API_KEY
 *   2. SMTP fallback      — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   3. If neither configured — logs a warning, skips silently
 *
 * Never throws — all errors are caught and logged so a failed email
 * never breaks a form submission response.
 */

import { pool } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadNotifyPayload {
  leadId: string;
  websiteId: string;
  pageId: string;
  submitterName?: string | null;
  submitterEmail: string;
  submitterPhone?: string | null;
  message?: string | null;
  formName?: string | null;
  sourcePageUrl?: string | null;
  sourcePageTitle?: string | null;
  formTimestamp: Date;
}

interface EmailRecipient {
  email: string;
  name?: string;
}

interface SendOptions {
  to: EmailRecipient;
  subject: string;
  html: string;
  replyTo?: string;
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

const FROM_EMAIL = process.env.LEAD_NOTIFY_FROM_EMAIL || process.env.SMTP_USER || "leads@spotonresults.com";
const FROM_NAME = process.env.LEAD_NOTIFY_FROM_NAME || "SpotOn Results Leads";

async function sendViaSendGrid(opts: SendOptions): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SENDGRID_API_KEY not set");

  const body = {
    personalizations: [{ to: [{ email: opts.to.email, name: opts.to.name || "" }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: opts.replyTo ? { email: opts.replyTo } : undefined,
    subject: opts.subject,
    content: [{ type: "text/html", value: opts.html }],
  };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`SendGrid error ${resp.status}: ${text}`);
  }
}

async function sendViaSmtp(opts: SendOptions): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error("SMTP env vars not configured");

  // Lazy-import nodemailer so it's not required if SendGrid is used.
  // If nodemailer is not in package.json, this will throw and fall through to the log.
  const nodemailer = await import("nodemailer").catch(() => { throw new Error("nodemailer not installed"); });
  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: opts.to.name ? `"${opts.to.name}" <${opts.to.email}>` : opts.to.email,
    replyTo: opts.replyTo,
    subject: opts.subject,
    html: opts.html,
  });
}

async function sendEmail(opts: SendOptions): Promise<void> {
  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid(opts);
  }
  if (process.env.SMTP_HOST) {
    return sendViaSmtp(opts);
  }
  console.warn("[lead-notify] No email transport configured. Set SENDGRID_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS to enable lead emails.");
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function buildLeadEmailHtml(lead: LeadNotifyPayload, businessName: string, recipientRole: "agency" | "client"): string {
  const ts = lead.formTimestamp.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  const pageLink = lead.sourcePageUrl ? `<a href="${lead.sourcePageUrl}" style="color:#01696f">${lead.sourcePageTitle || lead.sourcePageUrl}</a>` : (lead.sourcePageTitle || "Unknown page");
  const roleLabel = recipientRole === "agency" ? "one of your client accounts" : "your website";

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f6f2;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:#01696f;padding:24px 32px">
          <p style="margin:0;color:#ffffff;font-size:13px;letter-spacing:0.05em;text-transform:uppercase">New Lead Notification</p>
          <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700">New Lead for ${escHtml(businessName)}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 24px;color:#555;font-size:15px">A new lead was submitted from ${roleLabel}.</p>

          <!-- Lead Details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e3de;border-radius:6px;overflow:hidden;margin-bottom:24px">
            <tr style="background:#f9f8f5">
              <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;color:#7a7974;text-transform:uppercase;letter-spacing:0.06em">Contact Information</td>
            </tr>
            ${row("Name", lead.submitterName || "—")}
            ${row("Email", `<a href="mailto:${escHtml(lead.submitterEmail)}" style="color:#01696f">${escHtml(lead.submitterEmail)}</a>`)}
            ${row("Phone", lead.submitterPhone ? `<a href="tel:${escHtml(lead.submitterPhone)}" style="color:#01696f">${escHtml(lead.submitterPhone)}</a>` : "—")}
            ${lead.message ? row("Message", `<span style="white-space:pre-line">${escHtml(lead.message)}</span>`) : ""}
          </table>

          <!-- Source Info -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e3de;border-radius:6px;overflow:hidden;margin-bottom:24px">
            <tr style="background:#f9f8f5">
              <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;color:#7a7974;text-transform:uppercase;letter-spacing:0.06em">Lead Source</td>
            </tr>
            ${row("Form", escHtml(lead.formName || "Contact Form"))}
            ${row("Page", pageLink)}
            ${row("Submitted", ts + " MT")}
            ${row("Lead ID", `<code style="font-size:12px;color:#888">${lead.leadId}</code>`)}
          </table>

          <!-- CTA -->
          <p style="margin:0;color:#888;font-size:13px">Reply to this email or call the lead directly to follow up.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;background:#f3f0ec;border-top:1px solid #e5e3de">
          <p style="margin:0;font-size:12px;color:#bab9b4">Powered by SpotOn Results &mdash; White Pages Engine</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#28251d;width:110px;border-top:1px solid #f0ede8">${label}</td>
    <td style="padding:10px 16px;font-size:14px;color:#555;border-top:1px solid #f0ede8">${value}</td>
  </tr>`;
}

function escHtml(s: string | null | undefined): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

interface ResolvedRecipients {
  agencyEmail: string | null;
  agencyName: string | null;
  clientEmail: string | null;
  clientName: string | null;
  businessName: string;
}

async function resolveRecipients(websiteId: string): Promise<ResolvedRecipients> {
  // Single query: join websites → accounts → agencies to get all emails
  const result = await pool.query<{
    business_name: string;
    client_email: string | null;
    client_name: string | null;
    agency_email: string | null;
    agency_name: string | null;
  }>(
    `SELECT
       w.name                              AS business_name,
       a.primary_contact_email             AS client_email,
       a.name                              AS client_name,
       ag.owner_email                      AS agency_email,
       ag.name                             AS agency_name
     FROM websites w
     JOIN accounts a   ON a.id = w.account_id
     JOIN agencies ag  ON ag.id = a.agency_id
     WHERE w.id = $1
     LIMIT 1`,
    [websiteId],
  );

  const row = result.rows[0];
  if (!row) return { agencyEmail: null, agencyName: null, clientEmail: null, clientName: null, businessName: "Your Business" };

  return {
    businessName: row.business_name || "Your Business",
    clientEmail: row.client_email || null,
    clientName: row.client_name || null,
    agencyEmail: row.agency_email || null,
    agencyName: row.agency_name || null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function sendLeadNotification(lead: LeadNotifyPayload): Promise<void> {
  try {
    const recipients = await resolveRecipients(lead.websiteId);
    const { businessName, agencyEmail, agencyName, clientEmail, clientName } = recipients;

    const subject = `New Lead: ${lead.submitterName || lead.submitterEmail} — ${businessName}`;
    const sends: Promise<void>[] = [];

    // 1. Notify agency owner
    if (agencyEmail) {
      const html = buildLeadEmailHtml(lead, businessName, "agency");
      sends.push(
        sendEmail({ to: { email: agencyEmail, name: agencyName || undefined }, subject, html, replyTo: lead.submitterEmail })
          .catch(err => console.error(`[lead-notify] Failed to email agency owner (${agencyEmail}):`, err)),
      );
    }

    // 2. Notify client account contact
    if (clientEmail && clientEmail !== agencyEmail) {
      const html = buildLeadEmailHtml(lead, businessName, "client");
      sends.push(
        sendEmail({ to: { email: clientEmail, name: clientName || undefined }, subject, html, replyTo: lead.submitterEmail })
          .catch(err => console.error(`[lead-notify] Failed to email client (${clientEmail}):`, err)),
      );
    }

    if (sends.length === 0) {
      console.warn(`[lead-notify] No email recipients resolved for websiteId=${lead.websiteId} (leadId=${lead.leadId}). Add owner_email to agencies and primary_contact_email to accounts.`);
      return;
    }

    await Promise.all(sends);
    console.log(`[lead-notify] Sent ${sends.length} notification(s) for leadId=${lead.leadId} (${businessName})`);
  } catch (err) {
    // Never propagate — a failed email must never break a form submission
    console.error("[lead-notify] Unhandled error in sendLeadNotification:", err);
  }
}
