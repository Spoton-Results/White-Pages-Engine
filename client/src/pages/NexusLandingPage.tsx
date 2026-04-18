import React, { useState, useEffect, useRef, useCallback } from "react";

const BOOKING_URL = (import.meta as any).env?.VITE_BOOKING_URL || "#pricing";
const GA_ID = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID || "";

// ── Animation hook ────────────────────────────────────────────────────────────

function useFadeInUp() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useFadeInUp();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(30px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = useCallback((i: number) => setOpen(prev => prev === i ? null : i), []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            background: "#18181b",
            border: `1px solid ${open === i ? "rgba(59,130,246,0.35)" : "#27272a"}`,
            borderRadius: 10,
            overflow: "hidden",
            transition: "border-color 0.2s",
          }}
        >
          <button
            onClick={() => toggle(i)}
            aria-expanded={open === i}
            style={{
              width: "100%", textAlign: "left", padding: "20px 24px",
              background: "none", border: "none", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
              color: "#fafafa",
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              fontSize: 16, fontWeight: 500,
            }}
          >
            <span>{item.q}</span>
            <span style={{
              fontSize: 22, lineHeight: 1, color: "#3b82f6",
              flexShrink: 0, display: "inline-block",
              transition: "transform 0.25s ease",
              transform: open === i ? "rotate(45deg)" : "rotate(0deg)",
            }}>+</span>
          </button>
          <div style={{
            maxHeight: open === i ? 400 : 0,
            overflow: "hidden",
            transition: "max-height 0.35s ease",
          }}>
            <p style={{
              padding: "0 24px 20px", margin: 0,
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              fontSize: 15, lineHeight: 1.75, color: "#a1a1aa",
            }}>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stripe checkout helper ────────────────────────────────────────────────────

type Tier = "bundle" | "bundleAnnual" | "pilot";

async function createCheckoutSession(tier: Tier): Promise<{ url?: string; error?: string }> {
  const resp = await fetch("/api/stripe/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier }),
  });
  return resp.json();
}

// ── StripeButton ──────────────────────────────────────────────────────────────

function StripeButton({ tier, label, featured = false }: { tier: Tier; label: string; featured?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [comingSoon, setComingSoon] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleClick = async () => {
    if (loading || comingSoon) return;
    setLoading(true);
    setErrored(false);
    try {
      const { url, error } = await createCheckoutSession(tier);
      if (error === "coming_soon") { setComingSoon(true); return; }
      if (error) { setErrored(true); return; }
      if (url) window.location.href = url;
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  };

  const text = comingSoon ? "Coming Soon" : errored ? "Try Again" : loading ? "Loading…" : label;

  return (
    <div style={{ width: "100%" }}>
      <button
        onClick={handleClick}
        disabled={loading}
        className={featured ? "nx-btn-featured" : "nx-btn-primary"}
        style={{ width: "100%", justifyContent: "center" }}
        data-testid={`btn-stripe-${tier}`}
      >
        {text}
      </button>
      {errored && (
        <p style={{ color: "#f87171", fontSize: 13, marginTop: 8, textAlign: "center" }}>
          Something went wrong. Please try again or email us at hello@spotonnexus.com
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NexusLandingPage() {

  // Load fonts + inject styles
  useEffect(() => {
    document.title = "Nexus by SpotOn — Managed Local SEO Infrastructure for Agencies";

    // Meta description
    const metaDesc = "Generate, host, score, and manage thousands of local SEO pages for your agency clients. Quality scoring, tiered promotion, automated indexing, and weekly reporting included. Starting at $1 per page.";
    const setMeta = (selector: string, attr: string, name: string, value: string) => {
      let el = document.querySelector(selector) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", value);
    };
    setMeta('meta[name="description"]', "name", "description", metaDesc);
    const ogTitle = "Nexus by SpotOn — Managed Local SEO Infrastructure for Agencies";
    const metas: Array<[string, string, string, string]> = [
      ['meta[property="og:title"]', "property", "og:title", ogTitle],
      ['meta[property="og:description"]', "property", "og:description", metaDesc],
      ['meta[property="og:type"]', "property", "og:type", "website"],
      ['meta[name="twitter:title"]', "name", "twitter:title", ogTitle],
      ['meta[name="twitter:description"]', "name", "twitter:description", metaDesc],
      ['meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image"],
    ];
    metas.forEach(args => setMeta(...args));

    // Fonts
    const satoshi = document.createElement("link");
    satoshi.rel = "stylesheet";
    satoshi.href = "https://api.fontshare.com/v2/css?f[]=satoshi@700,900&display=swap";
    document.head.appendChild(satoshi);

    const gfonts = document.createElement("link");
    gfonts.rel = "stylesheet";
    gfonts.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap";
    document.head.appendChild(gfonts);

    // Styles
    const style = document.createElement("style");
    style.textContent = `
      html { scroll-behavior: smooth; }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #09090b; color: #fafafa; -webkit-font-smoothing: antialiased; }

      .nx-section { padding: 140px 24px; }
      .nx-container { max-width: 1100px; margin: 0 auto; }
      .nx-container-narrow { max-width: 760px; margin: 0 auto; }

      .nx-label {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px; font-weight: 500; letter-spacing: 0.12em;
        text-transform: uppercase; color: #3b82f6; margin-bottom: 16px;
        display: block;
      }
      .nx-label-green { color: #10b981; }

      .nx-h1 {
        font-family: 'Satoshi', 'Syne', sans-serif;
        font-size: clamp(40px, 7vw, 72px);
        font-weight: 900; line-height: 1.05; letter-spacing: -0.035em; color: #fafafa;
      }
      .nx-h2 {
        font-family: 'Satoshi', 'Syne', sans-serif;
        font-size: clamp(32px, 5vw, 52px);
        font-weight: 700; line-height: 1.1; letter-spacing: -0.03em; color: #fafafa;
      }
      .nx-h3 {
        font-family: 'Satoshi', 'Syne', sans-serif;
        font-size: 18px; font-weight: 700; color: #fafafa; letter-spacing: -0.01em;
      }
      .nx-body {
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 18px; line-height: 1.7; color: #a1a1aa;
      }
      .nx-body-sm {
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 15px; line-height: 1.7; color: #a1a1aa;
      }
      .nx-mono {
        font-family: 'JetBrains Mono', monospace;
      }

      .nx-btn-primary {
        display: inline-flex; align-items: center;
        padding: 16px 32px; background: #3b82f6; color: #fff;
        border: none; border-radius: 8px; cursor: pointer;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 15px; font-weight: 600; text-decoration: none;
        transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
        white-space: nowrap; min-height: 52px;
      }
      .nx-btn-primary:hover {
        background: #2563eb;
        box-shadow: 0 0 24px rgba(59,130,246,0.45);
        transform: translateY(-1px);
      }
      .nx-btn-ghost {
        display: inline-flex; align-items: center;
        padding: 15px 28px; background: transparent; color: #fafafa;
        border: 1px solid #27272a; border-radius: 8px; cursor: pointer;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 15px; font-weight: 500; text-decoration: none;
        transition: border-color 0.2s, transform 0.15s;
        white-space: nowrap; min-height: 52px;
      }
      .nx-btn-ghost:hover { border-color: #3b82f6; transform: translateY(-1px); }

      .nx-btn-featured {
        display: inline-flex; align-items: center;
        padding: 16px 32px;
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: #fff; border: none; border-radius: 8px; cursor: pointer;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 15px; font-weight: 700; text-decoration: none;
        transition: box-shadow 0.2s, transform 0.15s;
        white-space: nowrap; min-height: 52px;
        box-shadow: 0 4px 24px rgba(59,130,246,0.4);
      }
      .nx-btn-featured:hover {
        box-shadow: 0 6px 32px rgba(59,130,246,0.6);
        transform: translateY(-1px);
      }

      .nx-card {
        background: #18181b; border: 1px solid #27272a;
        border-radius: 12px; padding: 24px;
        transition: border-color 0.25s, box-shadow 0.25s;
      }
      .nx-card:hover {
        border-color: rgba(59,130,246,0.3);
        box-shadow: 0 0 20px rgba(59,130,246,0.07);
      }

      .nx-grid-3 {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
      }
      .nx-pricing-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-items: stretch;
      }

      .nx-pricing-card {
        background: rgba(24,24,27,0.8);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid #27272a;
        border-radius: 16px; padding: 36px;
        display: flex; flex-direction: column; gap: 0;
        transition: border-color 0.25s, box-shadow 0.25s;
      }
      .nx-pricing-card:hover { border-color: #3f3f46; }
      .nx-pricing-card.featured {
        border: 1px solid rgba(59,130,246,0.55);
        box-shadow: 0 0 0 1px rgba(59,130,246,0.15), 0 8px 40px rgba(59,130,246,0.12);
        position: relative;
        background: linear-gradient(180deg, rgba(20,40,80,0.6) 0%, rgba(24,24,27,0.9) 100%);
      }

      .nx-badge {
        display: inline-block;
        background: #3b82f6; color: #fff;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px; font-weight: 500; letter-spacing: 0.1em;
        text-transform: uppercase; padding: 4px 12px; border-radius: 20px;
        position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
        white-space: nowrap;
      }

      .nx-trust-bar {
        background: #111113; border-top: 1px solid #1c1c1e; border-bottom: 1px solid #1c1c1e;
        padding: 56px 24px;
      }
      .nx-trust-grid {
        display: grid; grid-template-columns: repeat(4, 1fr);
        max-width: 1000px; margin: 0 auto;
      }
      .nx-trust-divider { border-left: 1px solid #1f1f23; }

      .nx-timeline-dot {
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(13,24,60,0.8); border: 2px solid #3b82f6;
        display: flex; align-items: center; justify-content: center;
        font-family: 'JetBrains Mono', monospace; font-size: 13px;
        color: #3b82f6; font-weight: 500; flex-shrink: 0;
      }

      .nx-flow-pill {
        background: rgba(16,185,129,0.08);
        border: 1px solid rgba(16,185,129,0.25);
        color: #10b981; border-radius: 6px;
        padding: 10px 18px;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 13px; font-weight: 600;
      }
      .nx-flow-arrow { color: #374151; font-size: 20px; font-weight: 300; }

      .nx-proof-point {
        display: flex; align-items: flex-start; gap: 12;
        padding: 16px 20px; background: rgba(16,185,129,0.05);
        border: 1px solid rgba(16,185,129,0.15); border-radius: 8px;
      }

      .nx-founding {
        border: 1px dashed rgba(16,185,129,0.35);
        background: rgba(16,185,129,0.03);
        border-radius: 12px; padding: 60px 40px; text-align: center; margin-top: 40px;
      }

      .nx-enterprise {
        background: #111113; border: 1px solid #27272a;
        border-radius: 12px; padding: 32px 36px;
        margin-top: 24px;
        display: flex; align-items: center; justify-content: space-between; gap: 24px;
        flex-wrap: wrap;
      }

      .nx-hero-glow {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;
        background: radial-gradient(ellipse 70% 50% at 50% 40%, rgba(59,130,246,0.13) 0%, transparent 70%);
      }
      .nx-hero-dots {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;
        background-image: radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px);
        background-size: 28px 28px;
      }

      .nx-nav-link {
        color: #71717a; text-decoration: none;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; font-size: 14px;
        transition: color 0.15s;
      }
      .nx-nav-link:hover { color: #fafafa; }

      .nx-pricing-feature {
        display: flex; align-items: flex-start; gap: 10px;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 14px; color: #a1a1aa; padding: 6px 0; line-height: 1.5;
      }
      .nx-pricing-feature-bullet { color: #3b82f6; flex-shrink: 0; margin-top: 1px; font-size: 12px; }
      .nx-pricing-feature-bullet-green { color: #10b981; }

      .nx-addon-list { display: flex; flex-direction: column; width: 100%; }
      .nx-addon-row {
        display: flex; justify-content: space-between; align-items: center;
        gap: 16px; padding: 14px 4px;
        border-bottom: 1px solid #1f1f23;
      }
      .nx-addon-row:last-child { border-bottom: none; }
      .nx-addon-label {
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
        font-size: 14px; color: #a1a1aa; line-height: 1.5;
      }
      .nx-addon-price {
        font-size: 14px; color: #3b82f6; white-space: nowrap; flex-shrink: 0;
      }
      @media (max-width: 600px) {
        .nx-addon-row { flex-direction: column; align-items: flex-start; gap: 4px; }
        .nx-addon-price { font-size: 13px; }
      }

      @media (max-width: 900px) {
        .nx-grid-3 { grid-template-columns: 1fr; }
        .nx-pricing-grid { grid-template-columns: 1fr; }
        .nx-pricing-card.featured { transform: none !important; }
        .nx-enterprise { flex-direction: column; align-items: flex-start; }
      }
      @media (max-width: 700px) {
        .nx-trust-grid { grid-template-columns: repeat(2, 1fr); gap: 36px; }
        .nx-trust-divider { border-left: none; }
      }
      @media (max-width: 768px) {
        .nx-section { padding: 80px 20px; }
        .nx-btn-primary, .nx-btn-ghost, .nx-btn-featured { width: 100%; justify-content: center; }
        .nx-enterprise { padding: 24px 20px; }
      }
      @media (max-width: 480px) {
        .nx-pricing-card { padding: 28px 20px; }
      }

      /* Hamburger nav */
      .nx-desktop-nav { display: flex; align-items: center; gap: 8px; }
      .nx-hamburger-btn {
        display: none; background: none; border: none; cursor: pointer;
        color: #fafafa; padding: 8px; border-radius: 6px;
        flex-direction: column; gap: 5px; align-items: center; justify-content: center;
      }
      .nx-hamburger-bar {
        display: block; width: 22px; height: 2px;
        background: #fafafa; border-radius: 2px;
        transition: transform 0.2s, opacity 0.2s;
      }
      .nx-mobile-overlay {
        position: fixed; inset: 0; z-index: 200;
        background: rgba(9,9,11,0.98);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 8px;
      }
      .nx-mobile-link {
        font-family: 'Satoshi', 'Syne', sans-serif;
        font-size: 28px; font-weight: 700; color: #fafafa;
        text-decoration: none; padding: 16px 32px;
        letter-spacing: -0.02em;
        transition: color 0.15s;
      }
      .nx-mobile-link:hover { color: #3b82f6; }
      .nx-mobile-close {
        position: absolute; top: 20px; right: 24px;
        background: none; border: none; cursor: pointer;
        color: #71717a; font-size: 28px; line-height: 1; padding: 8px;
      }
      .nx-mobile-close:hover { color: #fafafa; }
      @media (max-width: 768px) {
        .nx-desktop-nav { display: none; }
        .nx-hamburger-btn { display: flex; }
      }
    `;
    document.head.appendChild(style);

    // GA
    if (GA_ID) {
      const gaScript = document.createElement("script");
      gaScript.async = true;
      gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(gaScript);
      const gaInit = document.createElement("script");
      gaInit.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`;
      document.head.appendChild(gaInit);
    }

    return () => {
      document.head.removeChild(satoshi);
      document.head.removeChild(gfonts);
      document.head.removeChild(style);
    };
  }, []);

  // ── Mobile menu ─────────────────────────────────────────────────────────────

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  // ── Stripe config (which add-ons are purchasable) ───────────────────────────

  const [bundleAnnualEnabled, setBundleAnnualEnabled] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  useEffect(() => {
    fetch("/api/stripe/config")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.bundleAnnualEnabled) setBundleAnnualEnabled(true);
      })
      .catch(() => {});
  }, []);

  // ── Data ────────────────────────────────────────────────────────────────────

  const steps = [
    {
      num: "01",
      title: "Launch the client",
      desc: "Set up the client website, brand profile, services, and locations inside the platform. Nexus supports multi-tenant management so one agency runs all client properties from one dashboard.",
    },
    {
      num: "02",
      title: "Build the content engine",
      desc: "Each service gets its own content variation bank with health checks across 8 core sections. Thin or incomplete banks are flagged before they become a scale problem.",
    },
    {
      num: "03",
      title: "Generate pages",
      desc: "Bulk generation creates service + location pages using blueprints and variation banks. The platform tracks progress, prevents duplicates, and auto-scores every new page.",
    },
    {
      num: "04",
      title: "Score and qualify",
      desc: "Pages are scored on a 100-point scale, assigned to promotion tiers, and filtered by quality. Only pages that meet the threshold get promoted to Google.",
    },
    {
      num: "05",
      title: "Automate everything after",
      desc: "Sitemap regeneration, internal link rebuilding, hub page linking, Google Indexing API submission, fallback demand monitoring, and weekly summary reports — all automatic.",
    },
  ];

  const features = [
    {
      icon: "◎",
      title: "Coverage at scale",
      desc: "Publish thousands of service-area pages without building them one by one. Cover every city your client serves.",
    },
    {
      icon: "◎",
      title: "Quality scoring",
      desc: "Score pages on a 100-point scale. Only pages above the threshold get promoted to Google through sitemaps and indexing.",
    },
    {
      icon: "◎",
      title: "Tiered promotion",
      desc: "Tier 1 pages go to Google. Tier 2 stays live but quiet. Tier 3 is hidden entirely. You control the dial.",
    },
    {
      icon: "◎",
      title: "Internal linking engine",
      desc: "Contextual links and hub-to-child page structures improve site architecture and distribute authority automatically.",
    },
    {
      icon: "◎",
      title: "Automated operations",
      desc: "Scoring, tiering, sitemap rebuilds, indexing submissions, fallback monitoring, and weekly reports run without manual work.",
    },
    {
      icon: "◎",
      title: "White-label multi-tenant",
      desc: "One admin panel manages all client websites. Each client gets their own brand profile, services, and page inventory.",
    },
  ];

  const faqItems = [
    {
      q: "Is this white-label?",
      a: "Yes. Nexus is a white-label multi-tenant platform. Each client gets their own brand profile, domain, and page inventory. Your clients never see the Nexus admin.",
    },
    {
      q: "Are the pages all the same template?",
      a: "No. Pages are assembled using service-level variation banks, blueprints, and multiple content sections designed to diversify output across every service and location combination.",
    },
    {
      q: "How do you control quality?",
      a: "Pages are scored on a 0–100 scale across 9 quality dimensions including content depth, local context, FAQ presence, and uniqueness. Only pages above the promotion threshold reach Google.",
    },
    {
      q: "What happens after pages go live?",
      a: "The platform auto-scores, auto-tiers, rebuilds sitemaps, submits Tier 1 URLs to Google's Indexing API, monitors fallback demand, auto-demotes underperforming pages, and sends weekly summary reports.",
    },
    {
      q: "Can this support more than one client website?",
      a: "Yes. The platform is multi-tenant by design. One agency account can manage unlimited client websites, each with their own brand profile, services, and page inventory.",
    },
    {
      q: "What if my client needs more than 1,000 pages?",
      a: "Add page blocks as needed. 5,000 pages is +$500/mo. 15,000 is +$1,500/mo. 50,000 is +$3,500/mo. All per site.",
    },
    {
      q: "Do I need to provide any API keys or technical setup?",
      a: "No. Everything is included and managed. You bring the client, we handle the entire infrastructure.",
    },
    {
      q: "How long until pages start showing up in Google?",
      a: "Pages roll out over 90 days for safe indexing. Most agencies see Search Console impressions climbing by month 2–3. Tier 1 pages are submitted directly through Google's Indexing API for faster discovery.",
    },
    {
      q: "What does my agency charge clients for this?",
      a: "Most agencies resell this as Advanced Local SEO at $1,500–$2,000 per client per month. At $3,000/mo for 3 clients, you are cash-flow positive on day one with $1,500–$3,000+ in margin.",
    },
  ];

  const pilotFeatures = [
    "1 client website",
    "Up to 5,000 pages",
    "60-day minimum commitment",
    "Quality scoring and tiering",
    "Automated sitemaps and indexing",
    "Internal linking and hub pages",
    "Weekly performance report",
  ];

  const bundleFeatures = [
    "3 client websites",
    "Up to 10,000 pages per site",
    "90-day rollout schedule",
    "Proprietary content engine",
    "Quality scoring and tiering",
    "Automated sitemaps and indexing",
    "Internal linking and hub pages",
    "Fallback demand monitoring",
    "Weekly performance report",
    "3-month minimum",
  ];

  const customFeatures = [
    "4+ client websites",
    "Up to 50,000 pages per site",
    "Statewide and national coverage",
    "White-label dashboard",
    "Monthly strategy call",
    "Custom rollout plan",
    "Dedicated onboarding",
  ];

  const addOnItems = [
    { label: "Additional client site (matches base plan page cap)", detail: "", price: "+$1,000/mo" },
    { label: "Coverage upgrade: Regional → Statewide", detail: "", price: "+$500/mo" },
    { label: "Coverage upgrade: Regional → National", detail: "", price: "+$1,000/mo" },
    { label: "Page cap upgrade: +5,000 pages", detail: "", price: "+$300/mo" },
    { label: "Page cap upgrade: +10,000 pages", detail: "", price: "+$500/mo" },
    { label: "Page cap upgrade: +25,000 pages", detail: "", price: "+$900/mo" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#09090b", minHeight: "100vh", color: "#fafafa", overflowX: "hidden" }}>

      {/* ── MOBILE MENU OVERLAY ── */}
      {mobileMenuOpen && (
        <div className="nx-mobile-overlay" role="dialog" aria-modal="true">
          <button className="nx-mobile-close" onClick={closeMobileMenu} aria-label="Close menu">✕</button>
          <a href="#how-it-works" className="nx-mobile-link" onClick={closeMobileMenu}>How it works</a>
          <a href="#pricing" className="nx-mobile-link" onClick={closeMobileMenu}>Pricing</a>
          <a href="#faq" className="nx-mobile-link" onClick={closeMobileMenu}>FAQ</a>
          <a
            href={BOOKING_URL}
            onClick={closeMobileMenu}
            className="nx-btn-primary"
            style={{ marginTop: 16, padding: "16px 40px", fontSize: 16 }}
            data-testid="link-mobile-cta"
          >
            Book a call
          </a>
        </div>
      )}

      {/* ── NAV ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(9,9,11,0.85)", backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid #18181b", padding: "0 24px",
        overflow: "hidden",
      }}>
        <div className="nx-container" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{
            fontFamily: "'Satoshi', 'Syne', sans-serif",
            fontWeight: 900, fontSize: "clamp(14px, 2.5vw, 17px)",
            letterSpacing: "-0.03em", color: "#fafafa", flexShrink: 0,
          }}>
            Nexus <span style={{ color: "#52525b", fontWeight: 400, fontSize: "clamp(12px, 2vw, 15px)" }}>by SpotOn</span>
          </span>

          {/* Desktop nav */}
          <div className="nx-desktop-nav">
            <a href="#how-it-works" className="nx-nav-link" style={{ padding: "0 12px" }}>How it works</a>
            <a href="#pricing" className="nx-nav-link" style={{ padding: "0 12px" }}>Pricing</a>
            <a href="#faq" className="nx-nav-link" style={{ padding: "0 12px" }}>FAQ</a>
            <a
              href={BOOKING_URL}
              className="nx-btn-primary"
              style={{ padding: "10px 20px", fontSize: 13, minHeight: 38, marginLeft: 8 }}
              data-testid="link-nav-cta"
            >
              Book a call
            </a>
          </div>

          {/* Hamburger button — mobile only */}
          <button
            className="nx-hamburger-btn"
            onClick={() => setMobileMenuOpen(o => !o)}
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            data-testid="btn-mobile-menu"
          >
            <span className="nx-hamburger-bar" />
            <span className="nx-hamburger-bar" />
            <span className="nx-hamburger-bar" />
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", textAlign: "center",
          padding: "140px 24px 100px", position: "relative", overflow: "hidden",
        }}
      >
        <div className="nx-hero-dots" />
        <div className="nx-hero-glow" />
        <div className="nx-container-narrow" style={{ position: "relative", zIndex: 1 }}>
          <FadeIn>
            <span className="nx-label" style={{ marginBottom: 24 }}>For SEO Agencies</span>
          </FadeIn>
          <FadeIn delay={80}>
            <h1 className="nx-h1" style={{ marginBottom: 28 }}>
              Scale local SEO without<br />
              <span style={{ color: "#3b82f6" }}>scaling headcount</span>
            </h1>
          </FadeIn>
          <FadeIn delay={160}>
            <p className="nx-body" style={{ maxWidth: 620, margin: "0 auto 44px", fontSize: 18 }}>
              Nexus generates, hosts, scores, and manages thousands of service-area pages
              for your clients — with quality controls, automated indexing, and weekly
              reporting built in.
            </p>
          </FadeIn>
          <FadeIn delay={240}>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 36 }}>
              <a href={BOOKING_URL} className="nx-btn-primary" data-testid="link-hero-primary">
                Book a Strategy Call
              </a>
              <a href="#pricing" className="nx-btn-ghost" data-testid="link-hero-pricing">
                See Pricing
              </a>
            </div>
            <p style={{
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              fontSize: 13, color: "#52525b",
            }}>
              Trusted by agencies managing 1.5M+ published pages
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <div className="nx-trust-bar">
        <div className="nx-trust-grid">
          {[
            { num: "1.5M+", label: "Published pages" },
            { num: "8", label: "Automated workflows" },
            { num: "50,000", label: "Max pages per site" },
            { num: "$1", label: "Per page at bundle rate" },
          ].map((stat, i) => (
            <div
              key={i}
              className={`nx-trust-item${i > 0 ? " nx-trust-divider" : ""}`}
              style={{ textAlign: "center", padding: "0 24px" }}
              data-testid={`stat-trust-${i}`}
            >
              <div
                className="nx-mono"
                style={{
                  fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500,
                  color: "#fafafa", marginBottom: 8, lineHeight: 1,
                }}
              >
                {stat.num}
              </div>
              <div style={{
                fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                fontSize: 13, color: "#71717a", letterSpacing: "0.01em",
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PROBLEM ── */}
      <section className="nx-section" id="problem">
        <div className="nx-container-narrow" style={{ textAlign: "center" }}>
          <FadeIn>
            <span className="nx-label">The Problem</span>
            <h2 className="nx-h2" style={{ marginBottom: 32 }}>Agencies hit a growth wall</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="nx-body" style={{ marginBottom: 48 }}>
              Most agencies can sell SEO. Few can deliver high-volume local coverage without hiring
              more people or shipping thin template pages that put their clients at risk with Google.
              <br /><br />
              That leaves two bad options:
            </p>
          </FadeIn>
          <FadeIn delay={140}>
            <div style={{
              background: "#111113", border: "1px solid #1c1c1e", borderRadius: 14,
              padding: "36px 40px", textAlign: "left", display: "inline-block", maxWidth: 560,
            }}>
              {[
                "Stay small and manual — you cap your revenue",
                "Scale fast and get messy — you risk client sites",
              ].map((line, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
                  <span style={{
                    color: "#ef4444", fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 18, lineHeight: 1.5, flexShrink: 0,
                  }}>→</span>
                  <span style={{
                    fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                    fontSize: 16, color: "#d4d4d8", lineHeight: 1.6,
                  }}>{line}</span>
                </div>
              ))}
              <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid #27272a" }}>
                <span style={{
                  fontFamily: "'Satoshi', 'Syne', sans-serif",
                  fontSize: 19, fontWeight: 700, color: "#fafafa",
                }}>
                  Nexus is the third option:{" "}
                  <span style={{ color: "#10b981" }}>safe-at-scale SEO operations.</span>
                </span>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── SOLUTION ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="solution">
        <div className="nx-container-narrow" style={{ textAlign: "center" }}>
          <FadeIn>
            <span className="nx-label">The Platform</span>
            <h2 className="nx-h2" style={{ marginBottom: 32 }}>What Nexus does</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="nx-body" style={{ marginBottom: 24 }}>
              Nexus is a managed SEO publishing platform that generates, organizes, scores, and controls
              large numbers of service-area pages per client website.
            </p>
            <p className="nx-body" style={{ marginBottom: 24 }}>
              Each page targets a real service + location combination. Pages are scored for quality,
              assigned to promotion tiers, organized through hub pages and internal links, and submitted
              to Google through automated workflows.
            </p>
            <p className="nx-body">
              Instead of blasting every page equally, Nexus controls which pages are promoted and which
              are held back. That is what separates it from basic page generators.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="how-it-works">
        <div className="nx-container" style={{ maxWidth: 860, margin: "0 auto" }}>
          <FadeIn>
            <span className="nx-label" style={{ display: "block", textAlign: "center" }}>Process</span>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 72 }}>How it works</h2>
          </FadeIn>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {steps.map((step, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div style={{
                  display: "flex", gap: 28,
                  paddingBottom: i < steps.length - 1 ? 52 : 0,
                }}>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div className="nx-timeline-dot">{step.num}</div>
                    {i < steps.length - 1 && (
                      <div style={{ width: 1, flex: 1, background: "#27272a", marginTop: 8 }} />
                    )}
                  </div>
                  <div style={{ paddingTop: 8, paddingBottom: i < steps.length - 1 ? 8 : 0 }}>
                    <h3 className="nx-h3" style={{ marginBottom: 12 }}>{step.title}</h3>
                    <p className="nx-body-sm">{step.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY NEXUS ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="features">
        <div className="nx-container">
          <FadeIn>
            <span className="nx-label" style={{ display: "block", textAlign: "center" }}>Why Nexus</span>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 56 }}>Built for agencies that deliver</h2>
          </FadeIn>
          <div className="nx-grid-3">
            {features.map((f, i) => (
              <FadeIn key={i} delay={i * 60}>
                <div className="nx-card" style={{ height: "100%" }}>
                  <div style={{
                    fontSize: 20, color: "#3b82f6", marginBottom: 16,
                    fontFamily: "monospace", lineHeight: 1,
                  }}>
                    {f.icon}
                  </div>
                  <h3 className="nx-h3" style={{ marginBottom: 10, fontSize: 16 }}>{f.title}</h3>
                  <p className="nx-body-sm">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SAFETY ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="safety">
        <div className="nx-container">
          <FadeIn>
            <span className="nx-label nx-label-green" style={{ display: "block", textAlign: "center" }}>Quality Controls</span>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 24 }}>
              Built to scale without acting reckless
            </h2>
            <p className="nx-body" style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 56px" }}>
              Nexus is not a spray-and-pray page generator. Every page goes through a governed
              publishing pipeline before it reaches Google.
            </p>
          </FadeIn>

          {/* Workflow pills */}
          <FadeIn delay={80}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, flexWrap: "wrap", marginBottom: 56,
            }}>
              {["Score", "Tier", "Sitemap", "Index", "Monitor"].flatMap((step, i, arr) => {
                const items: React.ReactNode[] = [
                  <div key={`step-${i}`} className="nx-flow-pill">{step}</div>
                ];
                if (i < arr.length - 1) {
                  items.push(<span key={`arrow-${i}`} className="nx-flow-arrow">→</span>);
                }
                return items;
              })}
            </div>
          </FadeIn>

          {/* Proof points */}
          <FadeIn delay={160}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680, margin: "0 auto" }}>
              {[
                "Pages below quality threshold are automatically held back from Google",
                "Tier 1 pages with zero impressions after 60 days are auto-demoted",
                "Thin content banks are flagged before generation even starts",
              ].map((point, i) => (
                <div key={i} className="nx-proof-point">
                  <span style={{ color: "#10b981", fontSize: 14, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span style={{
                    fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                    fontSize: 15, color: "#d4d4d8", lineHeight: 1.6,
                  }}>{point}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="nx-section" id="pricing">
        <div className="nx-container">
          <FadeIn>
            <span className="nx-label" style={{ display: "block", textAlign: "center" }}>Pricing</span>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 16 }}>Simple, transparent pricing</h2>
            <p className="nx-body" style={{ textAlign: "center", maxWidth: 540, margin: "0 auto 64px" }}>
              Starting at $1 per page. Built to be cash-flow positive for agencies from month one.
            </p>
          </FadeIn>

          {bundleAnnualEnabled && (
            <FadeIn delay={60}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
                <div
                  role="tablist"
                  aria-label="Billing period"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 999,
                    padding: 4,
                    gap: 4,
                  }}
                >
                  {([
                    { id: "monthly", label: "Monthly", suffix: null },
                    { id: "annual", label: "Annual", suffix: "save $6,000/yr" },
                  ] as const).map(opt => {
                    const active = billingPeriod === opt.id;
                    return (
                      <button
                        key={opt.id}
                        role="tab"
                        aria-selected={active}
                        onClick={() => setBillingPeriod(opt.id)}
                        data-testid={`btn-billing-${opt.id}`}
                        style={{
                          padding: "8px 18px",
                          fontSize: 13,
                          fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                          fontWeight: 600,
                          color: active ? "#fafafa" : "#71717a",
                          background: active ? "#3b82f6" : "transparent",
                          border: "none",
                          borderRadius: 999,
                          cursor: "pointer",
                          transition: "background 180ms, color 180ms",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {opt.label}
                        {opt.suffix && (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: active ? "#d1fae5" : "#10b981",
                            transition: "color 180ms",
                          }}>
                            {opt.suffix}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          )}

          <FadeIn delay={80}>
            <div className="nx-pricing-grid">

              {/* Left — Pilot */}
              <div className="nx-pricing-card" data-testid="card-pricing-pilot" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 24 }}>
                  <span className="nx-label" style={{ marginBottom: 8 }}>LOCAL LAUNCH</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                    <span className="nx-mono" style={{
                      fontSize: "clamp(36px, 5vw, 48px)", fontWeight: 500, color: "#fafafa", lineHeight: 1,
                    }}>$1,997</span>
                    <span style={{
                      fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                      fontSize: 14, color: "#71717a",
                    }}>/mo</span>
                  </div>
                  <p style={{
                    fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                    fontSize: 14, color: "#71717a", marginBottom: 0,
                  }}>For agencies testing programmatic SEO with their first client.</p>
                  {bundleAnnualEnabled && (
                    <p style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, color: "#52525b", marginTop: 8, marginBottom: 0,
                      letterSpacing: "0.02em",
                    }}>Monthly only</p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {pilotFeatures.map((f, i) => (
                    <div key={i} className="nx-pricing-feature">
                      <span className="nx-pricing-feature-bullet">●</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <StripeButton tier="pilot" label="Get Started — $1,997/mo" />
              </div>

              {/* Center — Bundle (featured) */}
              <div className="nx-pricing-card featured" data-testid="card-pricing-bundle" style={{ display: "flex", flexDirection: "column", transform: "scale(1.05)", transformOrigin: "center center", zIndex: 1 }}>
                <span className="nx-badge">Most Popular</span>
                <div style={{ marginBottom: 24 }}>
                  <span className="nx-label" style={{ marginBottom: 8 }}>The No-Brainer Bundle</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                    <span className="nx-mono" style={{
                      fontSize: "clamp(36px, 5vw, 48px)", fontWeight: 500, color: "#fafafa", lineHeight: 1,
                      transition: "color 180ms",
                    }} data-testid="text-bundle-price">
                      {billingPeriod === "annual" && bundleAnnualEnabled ? "$2,500" : "$3,000"}
                    </span>
                    <span style={{
                      fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                      fontSize: 14, color: "#71717a",
                    }}>/mo</span>
                  </div>
                  <p style={{
                    fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                    fontSize: 14, color: "#71717a", marginBottom: 0,
                  }}>3 clients. Full automation. Your highest-margin SEO offer.</p>
                  {billingPeriod === "annual" && bundleAnnualEnabled && (
                    <p style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, color: "#10b981", marginTop: 10, marginBottom: 0,
                      letterSpacing: "0.02em",
                    }} data-testid="text-bundle-annual-note">
                      Billed monthly at annual rate — save $6,000/year
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {bundleFeatures.map((f, i) => (
                    <div key={i} className="nx-pricing-feature">
                      <span className="nx-pricing-feature-bullet">●</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                {billingPeriod === "annual" && bundleAnnualEnabled
                  ? <StripeButton tier="bundleAnnual" label="Get Started — $2,500/mo" featured />
                  : <StripeButton tier="bundle" label="Get Started — $3,000/mo" featured />
                }
              </div>

              {/* Right — Custom */}
              <div className="nx-pricing-card" data-testid="card-pricing-custom" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 24 }}>
                  <span className="nx-label" style={{ marginBottom: 8 }}>Custom</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                    <span className="nx-mono" style={{
                      fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 500, color: "#fafafa", lineHeight: 1,
                    }}>Let's talk</span>
                  </div>
                  <p style={{
                    fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                    fontSize: 14, color: "#71717a", marginBottom: 0,
                  }}>For agencies scaling beyond 3 clients or needing national coverage.</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {customFeatures.map((f, i) => (
                    <div key={i} className="nx-pricing-feature">
                      <span className="nx-pricing-feature-bullet">●</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <a
                  href={BOOKING_URL}
                  className="nx-btn-ghost"
                  style={{ width: "100%", justifyContent: "center" }}
                  data-testid="link-pricing-custom-cta"
                >
                  Book a Strategy Call
                </a>
              </div>

            </div>
          </FadeIn>

          {/* Add-on strip */}
          <FadeIn delay={120}>
            <div style={{
              marginTop: 48, borderTop: "1px solid #27272a", paddingTop: 32,
            }}>
              <p style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, fontWeight: 500, letterSpacing: "0.12em",
                textTransform: "uppercase", color: "#52525b", marginBottom: 20,
                textAlign: "center",
              }}>Optional upgrades</p>
              <div className="nx-addon-list">
                {addOnItems.map((ao, i) => (
                  <div
                    key={i}
                    className="nx-addon-row"
                    data-testid={`row-addon-${i}`}
                  >
                    <span className="nx-addon-label">
                      {ao.label}{ao.detail ? ` (${ao.detail})` : ""}
                    </span>
                    <span className="nx-addon-price nx-mono">{ao.price}</span>
                  </div>
                ))}
              </div>
              <p style={{
                fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                fontSize: 13, color: "#71717a", marginTop: 24, marginBottom: 0,
                textAlign: "center",
              }} data-testid="text-addon-contact">
                Need an upgrade?{" "}
                <a
                  href="tel:+14354414100"
                  data-testid="link-addon-contact"
                  style={{
                    color: "#3b82f6",
                    textDecoration: "none",
                    borderBottom: "1px solid rgba(59,130,246,0.4)",
                    transition: "border-color 120ms",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)")}
                >
                  Call us
                </a>{" "}
                and we'll adjust your plan within 24 hours.
              </p>
            </div>
          </FadeIn>

          {/* Founding Agency */}
          <FadeIn delay={200}>
            <div className="nx-founding" data-testid="card-pricing-founding">
              <span className="nx-label nx-label-green" style={{ marginBottom: 8 }}>
                Founding Agency Offer — First 5 agencies only
              </span>
              <p style={{
                fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
                fontSize: 15, color: "#a1a1aa",
              }}>
                Setup reduced to $500/site. 6-month commitment required.
                Case study and testimonial rights.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="faq">
        <div className="nx-container" style={{ maxWidth: 800, margin: "0 auto" }}>
          <FadeIn>
            <span className="nx-label" style={{ display: "block", textAlign: "center" }}>FAQ</span>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 56 }}>
              Common questions
            </h2>
          </FadeIn>
          <FadeIn delay={80}>
            <Accordion items={faqItems} />
          </FadeIn>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="nx-section" style={{ textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(59,130,246,0.08) 0%, transparent 70%)",
        }} />
        <div className="nx-container-narrow" style={{ position: "relative", zIndex: 1 }}>
          <FadeIn>
            <h2 className="nx-h2" style={{ marginBottom: 24 }}>Stop selling SEO that can't scale</h2>
            <p className="nx-body" style={{ maxWidth: 560, margin: "0 auto 44px" }}>
              Nexus gives your agency the infrastructure to deliver more coverage, cleaner operations,
              and a more defensible offer — starting at $1 per page.
            </p>
            <a
              href={BOOKING_URL}
              className="nx-btn-primary"
              style={{ fontSize: 16, padding: "18px 40px" }}
              data-testid="link-final-cta"
            >
              Book a Strategy Call
            </a>
            <p style={{
              marginTop: 20,
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              fontSize: 13, color: "#52525b",
            }}>
              We will map your first 3 client sites, rollout plan, and page targets.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: "1px solid #18181b",
        padding: "40px 24px",
        textAlign: "center",
      }}>
        <div className="nx-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <span style={{
            fontFamily: "'Satoshi', 'Syne', sans-serif",
            fontWeight: 900, fontSize: 15, letterSpacing: "-0.02em", color: "#71717a",
          }}>
            Nexus by SpotOn
          </span>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
            <a href="#how-it-works" className="nx-nav-link" style={{ fontSize: 13 }}>How it works</a>
            <a href="#pricing" className="nx-nav-link" style={{ fontSize: 13 }}>Pricing</a>
            <a href="#faq" className="nx-nav-link" style={{ fontSize: 13 }}>FAQ</a>
            <a href={BOOKING_URL} className="nx-nav-link" style={{ fontSize: 13 }}>Book a call</a>
            <a href="tel:+14354414100" className="nx-nav-link" style={{ fontSize: 13 }} data-testid="link-footer-contact">Contact us: (435) 441-4100</a>
          </div>
          <span style={{
            fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
            fontSize: 12, color: "#3f3f46",
          }}>
            © {new Date().getFullYear()} SpotOn Nexus
          </span>
        </div>
      </footer>

    </div>
  );
}
