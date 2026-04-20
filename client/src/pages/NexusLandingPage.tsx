import React, { useState, useEffect, useRef, useCallback } from "react";

const BOOKING_URL = (import.meta as any).env?.VITE_BOOKING_URL || "https://link.spotonnexus.com/widget/booking/b1Be8Hfa2mgRZsFYviiF";
const GA_ID = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID || "";
const PHONE = "(844) 723-1900";
const PHONE_HREF = "tel:+18447231900";

function useFadeInUp() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useFadeInUp();
  return (
    <div ref={ref} className={className} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(24px)",
      transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = useCallback((i: number) => setOpen(prev => prev === i ? null : i), []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: "#fff",
          border: `1px solid ${open === i ? "#3b82f6" : "#e5e7eb"}`,
          borderRadius: 10,
          overflow: "hidden",
          transition: "border-color 0.2s",
          boxShadow: open === i ? "0 0 0 3px rgba(59,130,246,0.08)" : "none",
        }}>
          <button onClick={() => toggle(i)} aria-expanded={open === i} style={{
            width: "100%", textAlign: "left", padding: "20px 24px",
            background: "none", border: "none", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
            color: "#1f2937", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: 16, fontWeight: 600,
          }}>
            <span>{item.q}</span>
            <span style={{
              fontSize: 24, lineHeight: 1, color: "#3b82f6", flexShrink: 0,
              display: "inline-block", transition: "transform 0.25s ease",
              transform: open === i ? "rotate(45deg)" : "rotate(0deg)",
            }}>+</span>
          </button>
          <div style={{ maxHeight: open === i ? 400 : 0, overflow: "hidden", transition: "max-height 0.35s ease" }}>
            <p style={{
              padding: "0 24px 20px", margin: 0,
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: 15, lineHeight: 1.75, color: "#4b5563",
            }}>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

type Tier = "bundle" | "bundleAnnual" | "pilot";

async function createCheckoutSession(tier: Tier): Promise<{ url?: string; error?: string }> {
  const resp = await fetch("/api/stripe/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier }),
  });
  return resp.json();
}

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
        data-testid={`btn-stripe-${tier}`}
        style={{
          width: "100%", justifyContent: "center",
          display: "inline-flex", alignItems: "center",
          padding: "14px 24px",
          background: featured ? "#3b82f6" : "#fff",
          color: featured ? "#fff" : "#3b82f6",
          border: featured ? "none" : "2px solid #3b82f6",
          borderRadius: 8, cursor: loading ? "wait" : "pointer",
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 15, fontWeight: 700,
          transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
          boxShadow: featured ? "0 4px 14px rgba(59,130,246,0.35)" : "none",
          minHeight: 50,
        }}
        onMouseEnter={e => {
          if (!loading) {
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = featured
              ? "0 6px 20px rgba(59,130,246,0.45)"
              : "0 2px 8px rgba(59,130,246,0.2)";
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = featured
            ? "0 4px 14px rgba(59,130,246,0.35)"
            : "none";
        }}
      >
        {text}
      </button>
      {errored && (
        <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8, textAlign: "center" }}>
          Something went wrong. Email hello@spotonnexus.com
        </p>
      )}
    </div>
  );
}

const STYLES = `
  html { scroll-behavior: smooth; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; color: #1f2937; -webkit-font-smoothing: antialiased; }

  .lp-section { padding: 96px 24px; }
  .lp-section-gray { background: #f5f7fa; }
  .lp-container { max-width: 1100px; margin: 0 auto; }
  .lp-container-sm { max-width: 800px; margin: 0 auto; }

  .lp-eyebrow {
    display: inline-block;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 12px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #3b82f6; margin-bottom: 14px;
  }

  .lp-h1 {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: clamp(38px, 6vw, 64px);
    font-weight: 800; line-height: 1.08; letter-spacing: -0.03em; color: #111827;
  }
  .lp-h2 {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 800; line-height: 1.12; letter-spacing: -0.025em; color: #111827;
  }
  .lp-h3 {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 18px; font-weight: 700; color: #111827;
  }
  .lp-body {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 18px; line-height: 1.7; color: #4b5563;
  }
  .lp-body-sm {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 15px; line-height: 1.65; color: #6b7280;
  }

  .lp-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 15px 30px; background: #3b82f6; color: #fff;
    border: none; border-radius: 8px; cursor: pointer;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 16px; font-weight: 700; text-decoration: none;
    transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
    white-space: nowrap; min-height: 52px; box-shadow: 0 4px 14px rgba(59,130,246,0.35);
  }
  .lp-btn:hover {
    background: #2563eb; box-shadow: 0 6px 20px rgba(59,130,246,0.45);
    transform: translateY(-1px);
  }
  .lp-btn-outline {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 28px; background: transparent; color: #374151;
    border: 2px solid #d1d5db; border-radius: 8px; cursor: pointer;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 15px; font-weight: 600; text-decoration: none;
    transition: border-color 0.2s, color 0.2s, transform 0.15s;
    white-space: nowrap; min-height: 52px;
  }
  .lp-btn-outline:hover { border-color: #3b82f6; color: #3b82f6; transform: translateY(-1px); }

  .lp-nav-link {
    color: #4b5563; text-decoration: none;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 14px; font-weight: 500;
    transition: color 0.15s;
  }
  .lp-nav-link:hover { color: #1f2937; }

  .lp-card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px; padding: 28px;
    transition: border-color 0.25s, box-shadow 0.25s;
  }
  .lp-card:hover {
    border-color: #bfdbfe;
    box-shadow: 0 4px 24px rgba(59,130,246,0.08);
  }

  .lp-problem-card {
    background: #fff;
    border: 1px solid #fee2e2;
    border-radius: 14px; padding: 28px;
    border-top: 4px solid #f87171;
  }

  .lp-step-num {
    width: 44px; height: 44px; border-radius: 50%;
    background: #eff6ff; border: 2px solid #bfdbfe;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 16px; font-weight: 800; color: #3b82f6; flex-shrink: 0;
  }

  .lp-pricing-card {
    background: #fff;
    border: 2px solid #e5e7eb;
    border-radius: 16px; padding: 36px;
    display: flex; flex-direction: column;
    transition: border-color 0.25s, box-shadow 0.25s;
  }
  .lp-pricing-card:hover { border-color: #93c5fd; box-shadow: 0 4px 20px rgba(59,130,246,0.08); }
  .lp-pricing-card.featured {
    border: 2px solid #3b82f6;
    box-shadow: 0 8px 40px rgba(59,130,246,0.15);
    position: relative;
  }

  .lp-badge {
    display: inline-block;
    background: #3b82f6; color: #fff;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 4px 14px; border-radius: 20px;
    position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
    white-space: nowrap; box-shadow: 0 2px 8px rgba(59,130,246,0.4);
  }

  .lp-feature-row {
    display: flex; align-items: flex-start; gap: 10px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 14px; color: #4b5563; padding: 6px 0; line-height: 1.5;
  }
  .lp-feature-check { color: #3b82f6; flex-shrink: 0; margin-top: 2px; font-size: 14px; }

  .lp-stat { text-align: center; padding: 20px 12px; }

  .lp-logo-placeholder {
    display: inline-flex; align-items: center; justify-content: center;
    background: #f3f4f6; border: 1px solid #e5e7eb;
    border-radius: 8px; padding: 12px 24px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 13px; font-weight: 700; color: #9ca3af;
    letter-spacing: 0.05em; white-space: nowrap;
  }

  .lp-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .lp-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .lp-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
  .lp-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-items: start; }

  .lp-sticky-cta {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 90;
    background: #1f2937; border-top: 1px solid #374151;
    padding: 14px 24px;
    display: none;
    align-items: center; justify-content: space-between; gap: 16px;
  }

  .lp-hamburger-btn {
    display: none; background: none; border: none; cursor: pointer;
    color: #1f2937; padding: 8px; border-radius: 6px;
    flex-direction: column; gap: 5px; align-items: center; justify-content: center;
  }
  .lp-hamburger-bar {
    display: block; width: 22px; height: 2px;
    background: #1f2937; border-radius: 2px;
    transition: transform 0.2s, opacity 0.2s;
  }
  .lp-desktop-nav { display: flex; align-items: center; gap: 8px; }
  .lp-mobile-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(255,255,255,0.98);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px;
  }
  .lp-mobile-link {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 24px; font-weight: 700; color: #111827;
    text-decoration: none; padding: 14px 32px;
    transition: color 0.15s;
  }
  .lp-mobile-link:hover { color: #3b82f6; }
  .lp-mobile-close {
    position: absolute; top: 20px; right: 24px;
    background: none; border: none; cursor: pointer;
    color: #9ca3af; font-size: 28px; line-height: 1; padding: 8px;
  }
  .lp-mobile-close:hover { color: #1f2937; }

  @media (max-width: 900px) {
    .lp-grid-3 { grid-template-columns: 1fr; }
    .lp-grid-4 { grid-template-columns: repeat(2, 1fr); }
    .lp-pricing-grid { grid-template-columns: 1fr; }
    .lp-pricing-card.featured { transform: none !important; }
  }
  @media (max-width: 640px) {
    .lp-section { padding: 64px 20px; }
    .lp-grid-2 { grid-template-columns: 1fr; }
    .lp-grid-4 { grid-template-columns: repeat(2, 1fr); }
    .lp-btn, .lp-btn-outline { width: 100%; justify-content: center; }
    .lp-sticky-cta { display: flex; }
    .lp-desktop-nav { display: none !important; }
    .lp-hamburger-btn { display: flex !important; }
  }
  @media (max-width: 480px) {
    .lp-grid-4 { grid-template-columns: repeat(2, 1fr); }
    .lp-pricing-card { padding: 28px 20px; }
  }
`;

export default function NexusLandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bundleAnnualEnabled, setBundleAnnualEnabled] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  useEffect(() => {
    document.title = "Nexus by SpotOn Results — Scale Local SEO Without Scaling Headcount";

    const setMeta = (selector: string, attr: string, name: string, value: string) => {
      let el = document.querySelector(selector) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", value);
    };
    const desc = "Generate thousands of local SEO pages for agency clients. Quality scoring, tier promotion, automated indexing, and weekly reporting — starting at $1,997/mo.";
    const title = "Nexus by SpotOn Results — Scale Local SEO Without Scaling Headcount";
    setMeta('meta[name="description"]', "name", "description", desc);
    [
      ['meta[property="og:title"]', "property", "og:title", title],
      ['meta[property="og:description"]', "property", "og:description", desc],
      ['meta[property="og:type"]', "property", "og:type", "website"],
      ['meta[name="twitter:title"]', "name", "twitter:title", title],
      ['meta[name="twitter:description"]', "name", "twitter:description", desc],
    ].forEach((args: any) => setMeta(...(args as [string, string, string, string])));

    const gfonts = document.createElement("link");
    gfonts.rel = "stylesheet";
    gfonts.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(gfonts);

    const style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);

    if (GA_ID) {
      const s = document.createElement("script"); s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(s);
      const i = document.createElement("script");
      i.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`;
      document.head.appendChild(i);
    }

    const chatbot = document.createElement("script");
    chatbot.src = "https://beta.leadconnectorhq.com/loader.js";
    chatbot.setAttribute("data-resources-url", "https://beta.leadconnectorhq.com/chat-widget/loader.js");
    chatbot.setAttribute("data-widget-id", "69e64f9129e846cab81ed1f6");
    document.body.appendChild(chatbot);

    return () => {
      try { document.head.removeChild(gfonts); document.head.removeChild(style); } catch {}
      try { document.body.removeChild(chatbot); } catch {}
    };
  }, []);

  useEffect(() => {
    fetch("/api/stripe/config")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.bundleAnnualEnabled) setBundleAnnualEnabled(true); })
      .catch(() => {});
  }, []);

  const pilotFeatures = [
    "1 client website",
    "Up to 5,000 pages",
    "Quality scoring & tier promotion",
    "Automated sitemap & indexing",
    "Weekly reporting",
    "Onboarding call included",
  ];
  const bundleFeatures = [
    "3 client websites",
    "10,000 pages per site",
    "Everything in Local Launch",
    "Multi-tenant dashboard",
    "Priority support",
    "White-label ready",
    "Founding Agency pricing",
  ];
  const customFeatures = [
    "4+ client websites",
    "50,000+ pages per site",
    "Everything in Growth Bundle",
    "Custom integrations",
    "Dedicated success manager",
    "SLA guarantee",
  ];

  const faqItems = [
    { q: "How many pages can I generate per site?", a: "Millions. Most agencies start with 5,000–50,000 pages and scale based on performance. The platform handles duplicates, scoring, and indexing automatically regardless of volume." },
    { q: "Do I need my own API key?", a: "We recommend using your own Anthropic API key for full control. Or we manage it for you at a small markup — whichever you prefer." },
    { q: "How long until pages rank?", a: "Pages are submitted to Google Indexing API immediately after publishing. Ranking timelines depend on your client's domain authority, but most agencies see traction within 30–90 days." },
    { q: "Can I white-label it for clients?", a: "Yes. Each client gets their own account, brand profile, and dashboard. They never need to know Nexus is the infrastructure behind it." },
    { q: "What's quality scoring?", a: "Every page is scored on a 100-point scale across content depth, structure, and completeness. Only pages above your threshold get promoted to Google — so you never publish thin content at scale." },
    { q: "What if I need more than 3 clients?", a: "Contact us for custom pricing. We handle agencies managing 10+ clients with millions of pages. There's no hard ceiling." },
    { q: "Is there a setup fee?", a: "Founding Agency pricing includes reduced setup at $500/site for the first 5 agencies. Standard setup is $1,000/site after that." },
    { q: "Can I cancel anytime?", a: "Yes. Monthly plans can be cancelled before the next billing cycle. Annual plans are non-refundable but you keep access through the term." },
  ];

  return (
    <div style={{ background: "#fff", color: "#1f2937", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* ── MOBILE MENU ── */}
      {mobileMenuOpen && (
        <div className="lp-mobile-overlay" role="dialog" aria-modal="true">
          <button className="lp-mobile-close" onClick={closeMobileMenu} aria-label="Close menu">✕</button>
          {[
            ["#problem", "The Problem"],
            ["#solution", "Solution"],
            ["#how-it-works", "How It Works"],
            ["#pricing", "Pricing"],
            ["#faq", "FAQ"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="lp-mobile-link" onClick={closeMobileMenu}>{label}</a>
          ))}
          <div style={{ height: 16 }} />
          <a href={BOOKING_URL} className="lp-btn" style={{ fontSize: 16 }} onClick={closeMobileMenu} data-testid="link-mobile-book">
            Book a Strategy Call
          </a>
          <a href={PHONE_HREF} style={{
            marginTop: 12, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: 16, fontWeight: 700, color: "#3b82f6", textDecoration: "none",
          }}>{PHONE}</a>
        </div>
      )}

      {/* ── NAV ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid #e5e7eb",
        padding: "0 24px",
      }}>
        <div className="lp-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <a href="#" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 32, height: 32, background: "#3b82f6", borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" />
                <rect x="10" y="2" width="6" height="6" rx="1.5" fill="rgba(255,255,255,0.5)" />
                <rect x="2" y="10" width="6" height="6" rx="1.5" fill="rgba(255,255,255,0.5)" />
                <rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" />
              </svg>
            </div>
            <span style={{ fontWeight: 800, fontSize: 16, color: "#111827", letterSpacing: "-0.02em" }}>
              Nexus <span style={{ color: "#6b7280", fontWeight: 500 }}>by SpotOn</span>
            </span>
          </a>
          <div className="lp-desktop-nav" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {[["#problem","Problem"],["#solution","Solution"],["#how-it-works","How It Works"],["#pricing","Pricing"],["#faq","FAQ"]].map(([href, label]) => (
              <a key={href} href={href} className="lp-nav-link" style={{ padding: "8px 12px" }}>{label}</a>
            ))}
            <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 8px" }} />
            <a href={PHONE_HREF} style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: 14, fontWeight: 700, color: "#374151", textDecoration: "none",
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h2.5l1 2.5-1.5 1.5a9 9 0 003 3l1.5-1.5L11 8.5V11a1 1 0 01-1 1C4.477 12 2 6.523 2 2z" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {PHONE}
            </a>
            <a href={BOOKING_URL} className="lp-btn" style={{ padding: "10px 20px", fontSize: 14, minHeight: 40, boxShadow: "0 2px 8px rgba(59,130,246,0.3)" }} data-testid="link-nav-book">
              Book a Call
            </a>
          </div>
          <button className="lp-hamburger-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu" style={{ display: "none" }}>
            <span className="lp-hamburger-bar" />
            <span className="lp-hamburger-bar" />
            <span className="lp-hamburger-bar" />
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        background: "linear-gradient(180deg, #f0f7ff 0%, #ffffff 100%)",
        padding: "80px 24px 80px",
        borderBottom: "1px solid #e5e7eb",
      }}>
        <div className="lp-container">
          <div style={{ maxWidth: 760 }}>
            <FadeIn>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "6px 14px", marginBottom: 24 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1d4ed8" }}>Trusted by 150+ agencies · 1.5M+ pages published</span>
              </div>
            </FadeIn>
            <FadeIn delay={60}>
              <h1 className="lp-h1" style={{ marginBottom: 24 }}>
                Scale local SEO<br />
                <span style={{ color: "#3b82f6" }}>without scaling</span> headcount
              </h1>
            </FadeIn>
            <FadeIn delay={120}>
              <p className="lp-body" style={{ maxWidth: 580, marginBottom: 36, color: "#374151" }}>
                Generate thousands of optimized local SEO pages for your agency clients. Manage quality, indexing, and reporting from one dashboard — no extra hires needed.
              </p>
            </FadeIn>
            <FadeIn delay={180}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                <a href={BOOKING_URL} className="lp-btn" style={{ fontSize: 17, padding: "16px 36px" }} data-testid="link-hero-book">
                  Book a Strategy Call →
                </a>
                <a href="#pricing" className="lp-btn-outline" style={{ fontSize: 15 }} data-testid="link-hero-pricing">
                  See Pricing
                </a>
              </div>
              <p style={{ marginTop: 16, fontSize: 13, color: "#9ca3af" }}>
                No contract required on monthly plans · Setup call included
              </p>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section style={{ background: "#1e3a5f", padding: "0 24px" }}>
        <div className="lp-container">
          <div className="lp-grid-4" style={{ gap: 0 }}>
            {[
              { stat: "150+", label: "Agencies" },
              { stat: "1.5M+", label: "Pages Published" },
              { stat: "98K+", label: "Max Pages Per Site" },
              { stat: "$0", label: "Extra Headcount Needed" },
            ].map((s, i) => (
              <div key={i} className="lp-stat" style={{
                padding: "32px 20px",
                borderRight: i < 3 ? "1px solid rgba(255,255,255,0.1)" : "none",
              }}>
                <div style={{ fontSize: "clamp(28px, 3vw, 38px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>{s.stat}</div>
                <div style={{ fontSize: 13, color: "#93c5fd", marginTop: 6, fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF / LOGOS ── */}
      <section style={{ background: "#f9fafb", padding: "48px 24px", borderBottom: "1px solid #e5e7eb" }}>
        <div className="lp-container" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 28 }}>
            Agencies using Nexus to deliver at scale
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", alignItems: "center" }}>
            {["Summit Digital", "Rank Forge Agency", "LocalSEO Co.", "PageScale HQ", "ClimbFirst Media"].map((name, i) => (
              <span key={i} className="lp-logo-placeholder" data-testid={`logo-agency-${i}`}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROBLEM ── */}
      <section className="lp-section" id="problem">
        <div className="lp-container">
          <FadeIn>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px" }}>
              <span className="lp-eyebrow">The problem</span>
              <h2 className="lp-h2">The agency SEO trap</h2>
              <p className="lp-body" style={{ marginTop: 16 }}>
                Most agencies hit a wall. The more SEO clients you win, the more the margins shrink.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={60}>
            <div className="lp-grid-3">
              {[
                {
                  icon: "📉",
                  title: "Selling SEO but can't scale",
                  desc: "You close the client, then realize it takes 40 hours to build their location pages. You're trading time for revenue and can't grow.",
                  cost: "Cost: ~$3,000 in labor per client setup",
                },
                {
                  icon: "👥",
                  title: "Hiring more people, margins drop",
                  desc: "Every new client means another writer, another VA, another project manager. Your profit margin disappears as headcount grows.",
                  cost: "Cost: $50K–$80K per year per hire",
                },
                {
                  icon: "🚫",
                  title: "Template pages that don't rank",
                  desc: "Cheap page generators publish thin, duplicate content. Google ignores them — or worse, penalizes the whole domain.",
                  cost: "Cost: Client churn + reputation damage",
                },
              ].map((p, i) => (
                <div key={i} className="lp-problem-card" data-testid={`card-problem-${i}`}>
                  <div style={{ fontSize: 36, marginBottom: 16 }}>{p.icon}</div>
                  <h3 className="lp-h3" style={{ marginBottom: 10 }}>{p.title}</h3>
                  <p className="lp-body-sm" style={{ marginBottom: 16 }}>{p.desc}</p>
                  <div style={{
                    background: "#fef2f2", border: "1px solid #fecaca",
                    borderRadius: 6, padding: "8px 14px",
                    fontSize: 13, fontWeight: 600, color: "#dc2626",
                  }}>{p.cost}</div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── SOLUTION ── */}
      <section className="lp-section lp-section-gray" id="solution">
        <div className="lp-container">
          <FadeIn>
            <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px" }}>
              <span className="lp-eyebrow">The solution</span>
              <h2 className="lp-h2">Nexus: Infrastructure to deliver at scale</h2>
              <p className="lp-body" style={{ marginTop: 16 }}>
                Write your content once. Nexus generates, scores, and publishes thousands of pages automatically.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={60}>
            <div className="lp-grid-2" style={{ gap: 24 }}>
              {[
                {
                  icon: "⚡",
                  title: "Generate pages instantly",
                  desc: "Write once, publish to 100 cities. Set up a service content bank and Nexus generates every city variation — quality-controlled and ready to index.",
                  badge: "600× faster than manual",
                },
                {
                  icon: "🏆",
                  title: "Quality controls built in",
                  desc: "Every page is scored on a 100-point scale. Only pages above your threshold get promoted to Google. No thin content at scale.",
                  badge: "100-point scoring engine",
                },
                {
                  icon: "🤖",
                  title: "Automated everything",
                  desc: "Sitemap regeneration, Google Indexing API submission, internal linking, and weekly client reports — all run automatically without manual work.",
                  badge: "Zero manual ops",
                },
                {
                  icon: "🏷️",
                  title: "White-label multi-tenant",
                  desc: "Each client gets their own account and branded dashboard. You run all clients from one admin panel — they see only their own data.",
                  badge: "Your brand, your clients",
                },
              ].map((f, i) => (
                <div key={i} className="lp-card" data-testid={`card-solution-${i}`} style={{ display: "flex", gap: 20 }}>
                  <div style={{ fontSize: 32, flexShrink: 0, lineHeight: 1 }}>{f.icon}</div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                      <h3 className="lp-h3">{f.title}</h3>
                      <span style={{
                        background: "#eff6ff", color: "#1d4ed8",
                        fontSize: 11, fontWeight: 700, padding: "3px 10px",
                        borderRadius: 12, letterSpacing: "0.04em", whiteSpace: "nowrap",
                      }}>{f.badge}</span>
                    </div>
                    <p className="lp-body-sm">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
          <FadeIn delay={120}>
            <div style={{ textAlign: "center", marginTop: 48 }}>
              <a href={BOOKING_URL} className="lp-btn" data-testid="link-solution-book">
                Book a Strategy Call →
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section" id="how-it-works">
        <div className="lp-container">
          <FadeIn>
            <div style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 56px" }}>
              <span className="lp-eyebrow">How it works</span>
              <h2 className="lp-h2">From setup to ranking in 4 steps</h2>
            </div>
          </FadeIn>
          <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              {
                num: "1",
                title: "Upload client info & locations",
                desc: "Add the client's brand, services, and target cities. Nexus supports bulk location uploads with tier classification.",
              },
              {
                num: "2",
                title: "Nexus generates optimized pages",
                desc: "The content engine uses your variation banks and blueprints to generate unique, structured pages for every service–city combination.",
              },
              {
                num: "3",
                title: "Pages score, tier, and publish automatically",
                desc: "Every page gets scored. High-quality pages are promoted to Tier 1 and submitted to Google Indexing API. Lower-scored pages stay live but quiet.",
              },
              {
                num: "4",
                title: "Weekly reports sent to clients",
                desc: "Automated weekly summaries show page count, tier distribution, indexing status, and growth — ready to forward straight to the client.",
              },
            ].map((step, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div style={{ display: "flex", gap: 24, alignItems: "flex-start", padding: "28px 0", borderBottom: i < 3 ? "1px solid #f3f4f6" : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, flexShrink: 0 }}>
                    <div className="lp-step-num">{step.num}</div>
                    {i < 3 && <div style={{ width: 2, height: 40, background: "#e0e7ff", marginTop: 8 }} />}
                  </div>
                  <div style={{ paddingBottom: 8 }}>
                    <h3 className="lp-h3" style={{ marginBottom: 8 }}>{step.title}</h3>
                    <p className="lp-body-sm">{step.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-section lp-section-gray" id="pricing">
        <div className="lp-container">
          <FadeIn>
            <div style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 16px" }}>
              <span className="lp-eyebrow">Pricing</span>
              <h2 className="lp-h2">Simple, transparent pricing</h2>
              <p className="lp-body" style={{ marginTop: 16, marginBottom: 32 }}>
                No per-page fees. No surprises. One monthly rate covers your client sites end to end.
              </p>
            </div>
          </FadeIn>

          {bundleAnnualEnabled && (
            <FadeIn delay={40}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
                <div role="tablist" aria-label="Billing period" style={{
                  display: "inline-flex", alignItems: "center",
                  background: "#fff", border: "2px solid #e5e7eb",
                  borderRadius: 999, padding: 4, gap: 4,
                }}>
                  {([
                    { id: "monthly", label: "Monthly" },
                    { id: "annual", label: "Annual — save 20%" },
                  ] as const).map(opt => {
                    const active = billingPeriod === opt.id;
                    return (
                      <button key={opt.id} role="tab" aria-selected={active}
                        onClick={() => setBillingPeriod(opt.id)}
                        data-testid={`btn-billing-${opt.id}`}
                        style={{
                          padding: "8px 20px", fontSize: 13,
                          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                          fontWeight: 700, color: active ? "#fff" : "#6b7280",
                          background: active ? "#3b82f6" : "transparent",
                          border: "none", borderRadius: 999, cursor: "pointer",
                          transition: "background 180ms, color 180ms",
                          whiteSpace: "nowrap",
                        }}
                      >{opt.label}</button>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          )}

          <FadeIn delay={80}>
            <div className="lp-pricing-grid">

              {/* Local Launch */}
              <div className="lp-pricing-card" data-testid="card-pricing-pilot" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>Local Launch</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: "clamp(36px, 4vw, 48px)", fontWeight: 800, color: "#111827", lineHeight: 1, letterSpacing: "-0.04em" }}>$1,997</span>
                  <span style={{ fontSize: 14, color: "#9ca3af" }}>/mo</span>
                </div>
                <p className="lp-body-sm" style={{ marginBottom: 28 }}>For agencies testing programmatic SEO with their first client.</p>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {pilotFeatures.map((f, i) => (
                    <div key={i} className="lp-feature-row">
                      <span className="lp-feature-check">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <StripeButton tier="pilot" label="Get Started — $1,997/mo" />
              </div>

              {/* Growth Bundle — featured */}
              <div className="lp-pricing-card featured" data-testid="card-pricing-bundle" style={{ display: "flex", flexDirection: "column" }}>
                <span className="lp-badge">Most Popular</span>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#3b82f6" }}>Growth Bundle</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: "clamp(36px, 4vw, 48px)", fontWeight: 800, color: "#111827", lineHeight: 1, letterSpacing: "-0.04em" }} data-testid="text-bundle-price">
                    {billingPeriod === "annual" && bundleAnnualEnabled ? "$2,500" : "$3,000"}
                  </span>
                  <span style={{ fontSize: 14, color: "#9ca3af" }}>/mo</span>
                </div>
                {billingPeriod === "annual" && bundleAnnualEnabled && (
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", marginBottom: 4 }} data-testid="text-bundle-annual-note">
                    Save $6,000/year with annual billing
                  </p>
                )}
                <p className="lp-body-sm" style={{ marginBottom: 28 }}>3 clients. Full automation. Your highest-margin SEO offer.</p>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {bundleFeatures.map((f, i) => (
                    <div key={i} className="lp-feature-row">
                      <span className="lp-feature-check">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                {billingPeriod === "annual" && bundleAnnualEnabled
                  ? <StripeButton tier="bundleAnnual" label="Get Started — $2,500/mo" featured />
                  : <StripeButton tier="bundle" label="Get Started — $3,000/mo" featured />
                }
              </div>

              {/* Enterprise */}
              <div className="lp-pricing-card" data-testid="card-pricing-custom" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>Enterprise</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 800, color: "#111827", lineHeight: 1.1, letterSpacing: "-0.03em" }}>Custom</span>
                </div>
                <p className="lp-body-sm" style={{ marginBottom: 28 }}>For agencies scaling beyond 3 clients or needing national coverage.</p>
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 28, flex: 1 }}>
                  {customFeatures.map((f, i) => (
                    <div key={i} className="lp-feature-row">
                      <span className="lp-feature-check">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <a href={PHONE_HREF} style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  padding: "14px 24px", background: "#fff", color: "#374151",
                  border: "2px solid #d1d5db", borderRadius: 8, cursor: "pointer",
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 15, fontWeight: 700, textDecoration: "none",
                  minHeight: 50, transition: "border-color 0.2s, color 0.2s",
                  width: "100%",
                }} data-testid="link-pricing-custom-cta">
                  Call {PHONE}
                </a>
              </div>

            </div>
          </FadeIn>

          {/* Founding offer */}
          <FadeIn delay={140}>
            <div style={{
              marginTop: 40, border: "2px dashed #bbf7d0",
              background: "#f0fdf4", borderRadius: 14, padding: "36px 32px",
              textAlign: "center",
            }} data-testid="card-pricing-founding">
              <span className="lp-eyebrow" style={{ color: "#16a34a" }}>Founding Agency Offer — First 5 agencies only</span>
              <p className="lp-body-sm" style={{ color: "#374151", marginTop: 4 }}>
                Setup reduced to $500/site. 6-month commitment required. Case study and testimonial rights requested.
              </p>
              <a href={BOOKING_URL} className="lp-btn" style={{ marginTop: 20, background: "#16a34a", boxShadow: "0 4px 14px rgba(22,163,74,0.3)" }} data-testid="link-founding-book">
                Claim Founding Pricing →
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="lp-section" id="faq">
        <div className="lp-container-sm">
          <FadeIn>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <span className="lp-eyebrow">FAQ</span>
              <h2 className="lp-h2">Common questions</h2>
            </div>
          </FadeIn>
          <FadeIn delay={60}>
            <Accordion items={faqItems} />
          </FadeIn>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{ background: "#1e3a5f", padding: "80px 24px", textAlign: "center" }}>
        <div className="lp-container-sm">
          <FadeIn>
            <h2 style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, color: "#fff",
              letterSpacing: "-0.025em", marginBottom: 20,
            }}>
              Stop selling SEO that can't scale
            </h2>
            <p style={{ fontSize: 18, lineHeight: 1.7, color: "#93c5fd", maxWidth: 540, margin: "0 auto 40px" }}>
              Nexus gives your agency the infrastructure to deliver more coverage, cleaner operations, and a more defensible offer — without adding headcount.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={BOOKING_URL} className="lp-btn" style={{ fontSize: 17, padding: "16px 36px", background: "#3b82f6", boxShadow: "0 4px 20px rgba(59,130,246,0.5)" }} data-testid="link-final-book">
                Book a Strategy Call →
              </a>
              <a href={PHONE_HREF} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "15px 28px", background: "transparent", color: "#fff",
                border: "2px solid rgba(255,255,255,0.3)", borderRadius: 8,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 16, fontWeight: 700, textDecoration: "none", minHeight: 52,
              }} data-testid="link-final-phone">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2.5h3l1.5 3L4.5 7a10 10 0 004.5 4.5l1.5-2L13 11v3A1 1 0 0112 15C5.373 15 1 10.627 1 4a1 1 0 011-1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {PHONE}
              </a>
            </div>
            <p style={{ marginTop: 20, fontSize: 13, color: "#60a5fa" }}>
              We'll map your first 3 client sites, rollout plan, and page targets on the call.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: "#111827", padding: "40px 24px" }}>
        <div className="lp-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em", color: "#6b7280" }}>
            Nexus by SpotOn Results
          </span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              ["#how-it-works", "How it works"],
              ["#pricing", "Pricing"],
              ["#faq", "FAQ"],
            ].map(([href, label]) => (
              <a key={href} href={href} style={{ color: "#6b7280", textDecoration: "none", fontSize: 13, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>{label}</a>
            ))}
            <a href={PHONE_HREF} style={{ color: "#6b7280", textDecoration: "none", fontSize: 13, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} data-testid="link-footer-phone">{PHONE}</a>
          </div>
          <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 12, color: "#374151" }}>
            © {new Date().getFullYear()} SpotOn Nexus
          </span>
        </div>
      </footer>

      {/* ── MOBILE STICKY CTA ── */}
      <div className="lp-sticky-cta" role="complementary" data-testid="sticky-mobile-cta">
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Ready to scale?</div>
          <a href={PHONE_HREF} style={{ fontSize: 12, color: "#93c5fd", textDecoration: "none" }}>{PHONE}</a>
        </div>
        <a href={BOOKING_URL} className="lp-btn" style={{ padding: "12px 20px", fontSize: 14, minHeight: 44 }} data-testid="link-sticky-book">
          Book a Call →
        </a>
      </div>

    </div>
  );
}
