import { pool } from "../db";

export type PublicInternalLink = {
  slug: string;
  title: string;
  anchorText: string;
  linkType?: string | null;
};

export function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
}

function hostOnly(value: unknown): string {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./i, "")
    .trim();
}

function setting(website: any, key: string, fallback = "") {
  return String(website?.settings?.[key] || fallback || "").trim();
}

function pageUrl(website: any, slug: string): string {
  const host = hostOnly(website?.settings?.parentDomain || website?.settings?.publicDomain || website?.domain);
  const cleanSlug = String(slug || "").replace(/^\/+/, "");
  return host ? `https://${host}/${cleanSlug}` : `/${cleanSlug}`;
}

function telHref(phone: string): string {
  return phone.replace(/[^+\d]/g, "");
}

export async function getPublicInternalLinks(pageId: string, websiteId: string): Promise<PublicInternalLink[]> {
  try {
    const result = await pool.query(
      `SELECT il.anchor_text, il.link_type, p.slug, p.title
       FROM internal_links il
       JOIN pages p ON p.id::text = il.to_page_id::text
       WHERE il.website_id::text = $1::text
         AND il.from_page_id::text = $2::text
         AND p.status = 'published'
         AND COALESCE(p.noindex, false) = false
       ORDER BY il.created_at DESC
       LIMIT 12`,
      [websiteId, pageId],
    );

    return result.rows.map((row: any) => ({
      slug: row.slug,
      title: row.title,
      anchorText: row.anchor_text || row.title || row.slug,
      linkType: row.link_type,
    }));
  } catch (error) {
    console.error("Failed to load public internal links:", error);
    return [];
  }
}

function css() {
  return `<style>
:root{--blue:#2563eb;--dark:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.65}.nexus-wrap{max-width:1100px;margin:0 auto;padding:0 20px}.nexus-demo{background:linear-gradient(135deg,#0f172a,#1d4ed8);color:#fff}.nexus-demo .nexus-wrap,.nexus-header .nexus-wrap,.nexus-footer .nexus-wrap{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-top:18px;padding-bottom:18px}.nexus-header{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}.nexus-brand{font-weight:800;color:#0f172a;text-decoration:none}.nexus-actions{display:flex;gap:14px;flex-wrap:wrap}.nexus-actions a{font-weight:700;text-decoration:none;color:#0f172a}.nexus-eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#2563eb;margin:0 0 8px}.nexus-demo .nexus-eyebrow{color:#bfdbfe}.nexus-demo h2{font-size:clamp(22px,3vw,34px);line-height:1.15;margin:0 0 4px}.nexus-demo p{margin:0;opacity:.92}.hero{background:linear-gradient(135deg,#2563eb,#0f172a);color:white;padding:56px 20px}.hero h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 16px}.hero p{font-size:20px;max-width:760px;opacity:.92}.content{max-width:1100px;margin:42px auto;padding:clamp(24px,4vw,48px);background:white;border:1px solid var(--line);border-radius:24px;box-shadow:0 18px 45px rgba(15,23,42,.08)}h2{font-size:30px;line-height:1.2;margin:34px 0 12px}h3{font-size:22px;margin:28px 0 10px}a{color:#2563eb}.nexus-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 18px;border-radius:999px;background:#2563eb;color:#fff!important;text-decoration:none;font-weight:800;border:1px solid #2563eb}.nexus-button-light{background:#fff;color:#0f172a!important;border-color:#fff}.nexus-button-outline{background:#fff;color:#2563eb!important}.nexus-card{max-width:1100px;margin:28px auto;padding:clamp(22px,4vw,38px);background:#fff;border:1px solid var(--line);border-radius:24px;box-shadow:0 14px 38px rgba(15,23,42,.07)}.nexus-cta{display:flex;align-items:center;justify-content:space-between;gap:24px;background:linear-gradient(135deg,#eff6ff,#fff)}.nexus-cta h2,.nexus-lead h2,.nexus-links h2{font-size:clamp(24px,3vw,34px);margin:0 0 8px}.nexus-cta p,.nexus-lead p{margin:0;color:#64748b}.nexus-cta-actions{display:flex;gap:10px;flex-wrap:wrap}.nexus-lead{display:grid;grid-template-columns:minmax(0,.9fr) minmax(320px,1.1fr);gap:28px;align-items:start}.nexus-form{display:grid;gap:12px}.nexus-form label{display:grid;gap:5px;font-size:13px;font-weight:750;color:#334155}.nexus-form input,.nexus-form textarea{width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:11px 12px;font:inherit;background:#fff}.nexus-link-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.nexus-link-grid a{display:block;border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-decoration:none;font-weight:700;color:#0f172a;background:#f8fafc}.nexus-footer{margin-top:42px;background:#0f172a;color:#cbd5e1}.nexus-footer a{color:#fff;text-decoration:none;font-weight:700;margin-left:14px}@media(max-width:760px){.nexus-demo .nexus-wrap,.nexus-header .nexus-wrap,.nexus-footer .nexus-wrap,.nexus-cta{align-items:flex-start;flex-direction:column}.content,.nexus-card{margin:18px 12px;padding:20px;border-radius:18px}.nexus-lead{grid-template-columns:1fr}.nexus-link-grid{grid-template-columns:1fr}.nexus-button{width:100%}.nexus-cta-actions{width:100%;flex-direction:column}.nexus-footer a{display:block;margin:8px 0 0}}
</style>`;
}

function demoBanner(website: any) {
  const url = normalizeUrl(setting(website, "demoBannerUrl"));
  if (!url) return "";
  const heading = setting(website, "demoBannerHeading", "See This Platform in Action");
  const subtext = setting(website, "demoBannerSubtext", "See how this page was built and how the system works.");
  const label = setting(website, "demoBannerButtonLabel", "Watch the Live Demo →");
  return `<section class="nexus-demo"><div class="nexus-wrap"><div><p class="nexus-eyebrow">Live walkthrough</p><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(subtext)}</p></div><a class="nexus-button nexus-button-light" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></div></section>`;
}

function header(website: any) {
  const main = normalizeUrl(setting(website, "mainWebsiteUrl"));
  const phone = setting(website, "phone");
  const brand = website?.name || hostOnly(main || website?.domain) || "SpotOn Results";
  if (!main && !phone) return "";
  return `<header class="nexus-header"><div class="nexus-wrap">${main ? `<a class="nexus-brand" href="${escapeHtml(main)}">${escapeHtml(brand)}</a>` : `<span class="nexus-brand">${escapeHtml(brand)}</span>`}<nav class="nexus-actions">${main ? `<a href="${escapeHtml(main)}">Main Website</a>` : ""}${phone ? `<a href="tel:${escapeHtml(telHref(phone))}">${escapeHtml(phone)}</a>` : ""}</nav></div></header>`;
}

function cta(website: any) {
  const main = normalizeUrl(setting(website, "mainWebsiteUrl"));
  const phone = setting(website, "phone");
  const heading = setting(website, "ctaHeading", "Ready to Lower Your Processing Fees?");
  const text = setting(website, "ctaText", "Get a clear look at your payment costs and see where savings may be possible.");
  const label = setting(website, "ctaButtonLabel", "Get a Free Quote →");
  return `<section class="nexus-card nexus-cta"><div><p class="nexus-eyebrow">Next step</p><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p></div><div class="nexus-cta-actions"><a class="nexus-button" href="${escapeHtml(main || "#quote")}">${escapeHtml(label)}</a>${phone ? `<a class="nexus-button nexus-button-outline" href="tel:${escapeHtml(telHref(phone))}">${escapeHtml(phone)}</a>` : ""}</div></section>`;
}

function leadForm(page: any, canonicalUrl: string) {
  const websiteId = page.website_id || page.websiteId || "";
  const pageId = page.id || "";
  const serviceId = page.service_id || page.serviceId || "";
  const locationId = page.location_id || page.locationId || "";
  if (!websiteId || !pageId || !serviceId) return "";
  return `<section class="nexus-card nexus-lead" id="quote"><div><p class="nexus-eyebrow">Request pricing</p><h2>Get a Free Quote</h2><p>Send a quick note and SpotOn Results will follow up with next steps.</p></div><form class="nexus-form" method="post" action="/api/form-tracking/submit"><input type="hidden" name="websiteId" value="${escapeHtml(websiteId)}"/><input type="hidden" name="pageId" value="${escapeHtml(pageId)}"/><input type="hidden" name="serviceId" value="${escapeHtml(serviceId)}"/><input type="hidden" name="locationId" value="${escapeHtml(locationId)}"/><input type="hidden" name="formName" value="Public Page Quote Form"/><input type="hidden" name="sourcePageUrl" value="${escapeHtml(canonicalUrl)}"/><input type="hidden" name="sourcePageTitle" value="${escapeHtml(page.title || page.h1 || page.slug)}"/><label>Name<input name="submitterName" autocomplete="name" placeholder="Your name"/></label><label>Email<input name="submitterEmail" type="email" autocomplete="email" placeholder="you@example.com" required/></label><label>Phone<input name="submitterPhone" autocomplete="tel" placeholder="Best phone number"/></label><label>Message<textarea name="message" rows="4" placeholder="Tell us what you need help with"></textarea></label><button class="nexus-button" type="submit">Submit Request</button></form></section>`;
}

function internalLinks(links: PublicInternalLink[], website: any) {
  if (!links.length) return "";
  return `<section class="nexus-card nexus-links"><p class="nexus-eyebrow">Related resources</p><h2>Explore More Helpful Pages</h2><div class="nexus-link-grid">${links.map((l) => `<a href="${escapeHtml(pageUrl(website, l.slug))}">${escapeHtml(l.anchorText || l.title || l.slug)}</a>`).join("")}</div></section>`;
}

function footer(website: any) {
  const main = normalizeUrl(setting(website, "mainWebsiteUrl"));
  const phone = setting(website, "phone");
  const brand = website?.name || hostOnly(main || website?.domain) || "SpotOn Results";
  return `<footer class="nexus-footer"><div class="nexus-wrap"><p>© ${new Date().getFullYear()} ${escapeHtml(brand)}. All rights reserved.</p><div>${main ? `<a href="${escapeHtml(main)}">Visit ${escapeHtml(brand)}</a>` : ""}${phone ? `<a href="tel:${escapeHtml(telHref(phone))}">${escapeHtml(phone)}</a>` : ""}</div></div></footer>`;
}

export function buildEnhancedPublicPageHtml(input: {
  page: any;
  website: any;
  contentHtml: string;
  canonicalUrl: string;
  links?: PublicInternalLink[];
}) {
  const { page, website, contentHtml, canonicalUrl, links = [] } = input;
  const title = page.title || page.h1 || page.slug;
  const desc = page.meta_description || page.metaDescription || "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>${desc ? `<meta name="description" content="${escapeHtml(desc)}"/>` : ""}<link rel="canonical" href="${escapeHtml(canonicalUrl)}"/>${css()}</head><body>${demoBanner(website)}${header(website)}<section class="hero"><div class="nexus-wrap"><h1>${escapeHtml(page.h1 || title)}</h1>${desc ? `<p>${escapeHtml(desc)}</p>` : ""}</div></section><main class="content">${contentHtml || `<p>${escapeHtml(desc || title)}</p>`}</main>${cta(website)}${leadForm(page, canonicalUrl)}${internalLinks(links, website)}${footer(website)}</body></html>`;
}
