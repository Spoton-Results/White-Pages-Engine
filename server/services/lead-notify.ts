/**
 * lead-notify.ts
 * Sends lead notification emails to:
 *   1. The agency owner who manages the website's account
 *   2. The client (account primary contact email)
 *
 * Transport: Resend API (RESEND_API_KEY) — no package install needed, pure fetch.
 * From:      noreply@reply.spotonresults.com
 * Reply-To:  the lead's email address so recipients can reply directly to the lead.
 *
 * Never throws — all errors caught so a failed email never breaks a form submission.
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
// Config — from address is your verified Resend domain
// ---------------------------------------------------------------------------

const FROM_EMAIL = "noreply@reply.spotonresults.com";
const FROM_NAME  = process.env.LEAD_NOTIFY_FROM_NAME || "SpotOn Results";

// ---------------------------------------------------------------------------
// Transport: Resend (pure fetch — no npm package required)
// ---------------------------------------------------------------------------

async function sendViaResend(opts: SendOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[lead-notify] RESEND_API_KEY is not set. Lead email skipped.");
    return;
  }

  const body = {
    from:     `${FROM_NAME} <${FROM_EMAIL}>`,
    to:       [opts.to.name ? `${opts.to.name} <${opts.to.email}>` : opts.to.email],
    reply_to: opts.replyTo ?? FROM_EMAIL,
    subject:  opts.subject,
    html:     opts.html,
  };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Resend error ${resp.status}: ${text}`);
  }

  const json = await resp.json().catch(() => ({}));
  console.log(`[lead-notify] Resend accepted → id=${(json as any)?.id} to=${opts.to.email}`);
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function buildLeadEmailHtml(
  lead: LeadNotifyPayload,
  businessName: string,
  recipientRole: "agency" | "client",
): string {
  const ts = lead.formTimestamp.toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const pageLink = lead.sourcePageUrl
    ? `<a href="${escHtml(lead.sourcePageUrl)}" style="color:#01696f">${escHtml(lead.sourcePageTitle || lead.sourcePageUrl)}</a>`
    : escHtml(lead.sourcePageTitle || "Unknown page");
  const roleLabel =
    recipientRole === "agency"
      ? `one of your client accounts (<strong>${escHtml(businessName)}</strong>)`
      : "your website";

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
          <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.75">New Lead Notification</p>
          <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3">
            New Lead &mdash; ${escHtml(businessName)}
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6">
            A new lead was submitted from ${roleLabel}.
          </p>

          <!-- Contact Details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e3de;border-radius:6px;overflow:hidden;margin-bottom:20px">
            <tr style="background:#f9f8f5">
              <td colspan="2" style="padding:10px 16px;font-size:11px;font-weight:700;color:#7a7974;text-transform:uppercase;letter-spacing:0.08em">
                Contact Information
              </td>
            </tr>
            ${tableRow("Name",    escHtml(lead.submitterName || "—"))}
            ${tableRow("Email",   `<a href="mailto:${escHtml(lead.submitterEmail)}" style="color:#01696f;font-weight:600">${escHtml(lead.submitterEmail)}</a>`)}
            ${tableRow("Phone",   lead.submitterPhone
                ? `<a href="tel:${escHtml(lead.submitterPhone)}" style="color:#01696f;font-weight:600">${escHtml(lead.submitterPhone)}</a>`
                : "—")}
            ${lead.message ? tableRow("Message", `<span style="white-space:pre-line;color:#333">${escHtml(lead.message)}</span>`) : ""}
          </table>

          <!-- Lead Source -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e3de;border-radius:6px;overflow:hidden;margin-bottom:28px">
            <tr style="background:#f9f8f5">
              <td colspan="2" style="padding:10px 16px;font-size:11px;font-weight:700;color:#7a7974;text-transform:uppercase;letter-spacing:0.08em">
                Lead Source
              </td>
            </tr>
            ${tableRow("Form",      escHtml(lead.formName || "Contact Form"))}
            ${tableRow("Page",      pageLink)}
            ${tableRow("Submitted", `${ts} MT`)}
            ${tableRow("Lead ID",   `<code style="font-size:11px;color:#aaa;background:#f5f5f5;padding:2px 6px;border-radius:3px">${lead.leadId}</code>`)}
          </table>

          <p style="margin:0;color:#aaa;font-size:13px">
            Reply to this email to respond directly to the lead.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:14px 32px;background:#f3f0ec;border-top:1px solid #e5e3de">
          <p style="margin:0;font-size:11px;color:#bab9b4">
            Sent by SpotOn Results &mdash; White Pages Engine &bull; ${escHtml(FROM_EMAIL)}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function tableRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:9px 16px;font-size:13px;font-weight:600;color:#28251d;width:100px;border-top:1px solid #f0ede8;vertical-align:top">${label}</td>
    <td style="padding:9px 16px;font-size:14px;color:#555;border-top:1px solid #f0ede8">${value}</td>
  </tr>`;
}

function escHtml(s: string | null | undefined): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Recipient resolution  (websites → accounts → agencies)
// ---------------------------------------------------------------------------

interface ResolvedRecipients {
  agencyEmail:  string | null;
  agencyName:   string | null;
  clientEmail:  string | null;
  clientName:   string | null;
  businessName: string;
}

async function resolveRecipients(websiteId: string): Promise<ResolvedRecipients> {
  const result = await pool.query<{
    business_name: string;
    client_email:  string | null;
    client_name:   string | null;
    agency_email:  string | null;
    agency_name:   string | null;
  }>(
    `SELECT
       w.name                         AS business_name,
       a.primary_contact_email        AS client_email,
       a.name                         AS client_name,
       ag.owner_email                 AS agency_email,
       ag.name                        AS agency_name
     FROM websites  w
     JOIN accounts  a  ON a.id  = w.account_id
     JOIN agencies  ag ON ag.id = a.agency_id
     WHERE w.id = $1
     LIMIT 1`,
    [websiteId],
  );

  const r = result.rows[0];
  if (!r) {
    return {
      agencyEmail: null, agencyName: null,
      clientEmail: null, clientName: null,
      businessName: "Your Business",
    };
  }

  return {
    businessName: r.business_name || "Your Business",
    clientEmail:  r.client_email  || null,
    clientName:   r.client_name   || null,
    agencyEmail:  r.agency_email  || null,
    agencyName:   r.agency_name   || null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — always fire-and-forget from the route layer
// ---------------------------------------------------------------------------

export async function sendLeadNotification(lead: LeadNotifyPayload): Promise<void> {
  try {
    const {
      businessName,
      agencyEmail, agencyName,
      clientEmail, clientName,
    } = await resolveRecipients(lead.websiteId);

    const subject = `New Lead: ${lead.submitterName || lead.submitterEmail} — ${businessName}`;
    const sends: Promise<void>[] = [];

    // 1. Agency owner — framed as "one of your client accounts"
    if (agencyEmail) {
      const html = buildLeadEmailHtml(lead, businessName, "agency");
      sends.push(
        sendViaResend({
          to: { email: agencyEmail, name: agencyName || undefined },
          subject,
          html,
          replyTo: lead.submitterEmail,
        }).catch(err =>
          console.error(`[lead-notify] Failed → agency (${agencyEmail}):`, err),
        ),
      );
    }

    // 2. Client account contact — framed as "your website"
    //    Skip if same address as agency to avoid duplicates
    if (clientEmail && clientEmail.toLowerCase() !== agencyEmail?.toLowerCase()) {
      const html = buildLeadEmailHtml(lead, businessName, "client");
      sends.push(
        sendViaResend({
          to: { email: clientEmail, name: clientName || undefined },
          subject,
          html,
          replyTo: lead.submitterEmail,
        }).catch(err =>
          console.error(`[lead-notify] Failed → client (${clientEmail}):`, err),
        ),
      );
    }

    if (sends.length === 0) {
      console.warn(
        `[lead-notify] No recipients resolved for websiteId=${lead.websiteId} ` +
        `(leadId=${lead.leadId}). Ensure agencies.owner_email and ` +
        `accounts.primary_contact_email are populated.`,
      );
      return;
    }

    await Promise.all(sends);
    console.log(
      `[lead-notify] ✓ ${sends.length} email(s) sent for leadId=${lead.leadId} (${businessName})`,
    );
  } catch (err) {
    // Never propagate — a broken email must never fail a form submission
    console.error("[lead-notify] Unhandled error:", err);
  }
}
