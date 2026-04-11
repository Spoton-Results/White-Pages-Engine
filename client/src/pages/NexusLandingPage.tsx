import { useState, useEffect, useRef, useCallback } from "react";

const BOOKING_URL = (import.meta as any).env?.VITE_BOOKING_URL || "#pricing";
const GA_ID = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID || "";

function useFadeInUp(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
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
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = useCallback((i: number) => setOpen(prev => prev === i ? null : i), []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            background: "#141414",
            border: "1px solid #1f1f1f",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => toggle(i)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "20px 24px",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              color: "#f5f5f5",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 16,
              fontWeight: 500,
            }}
            aria-expanded={open === i}
          >
            <span>{item.q}</span>
            <span style={{
              fontSize: 20,
              color: "#3b82f6",
              transition: "transform 0.25s",
              transform: open === i ? "rotate(45deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}>+</span>
          </button>
          <div style={{
            maxHeight: open === i ? 400 : 0,
            overflow: "hidden",
            transition: "max-height 0.35s ease",
          }}>
            <p style={{
              padding: "0 24px 20px",
              color: "#a3a3a3",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 15,
              lineHeight: 1.7,
              margin: 0,
            }}>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NexusLandingPage() {
  useEffect(() => {
    document.title = "Nexus by SpotOn — Managed Local SEO Infrastructure for Agencies";

    const existingMeta = document.querySelector('meta[name="description"]');
    const desc = "Launch and manage thousands of client service-area pages with built-in quality scoring, tiered promotion, automated sitemaps, internal linking, hub pages, and weekly reporting.";
    if (existingMeta) {
      existingMeta.setAttribute("content", desc);
    } else {
      const m = document.createElement("meta");
      m.name = "description";
      m.content = desc;
      document.head.appendChild(m);
    }

    const ogTags: Record<string, string> = {
      "og:title": "Nexus by SpotOn — Managed Local SEO Infrastructure for Agencies",
      "og:description": desc,
      "og:type": "website",
      "twitter:title": "Nexus by SpotOn — Managed Local SEO Infrastructure for Agencies",
      "twitter:description": desc,
      "twitter:card": "summary_large_image",
    };
    Object.entries(ogTags).forEach(([prop, content]) => {
      let el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
      if (!el) {
        el = document.createElement("meta");
        const isOg = prop.startsWith("og:");
        el.setAttribute(isOg ? "property" : "name", prop);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    });

    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(fontLink);

    const style = document.createElement("style");
    style.textContent = `
      html { scroll-behavior: smooth; }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0a0a0a; color: #f5f5f5; }
      .nx-btn-primary {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 14px 32px; background: #3b82f6; color: #fff;
        border: none; border-radius: 8px; cursor: pointer;
        font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600;
        text-decoration: none; transition: background 0.2s, transform 0.15s;
        white-space: nowrap;
      }
      .nx-btn-primary:hover { background: #2563eb; transform: translateY(-1px); }
      .nx-btn-ghost {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 13px 28px; background: transparent; color: #f5f5f5;
        border: 1px solid #2a2a2a; border-radius: 8px; cursor: pointer;
        font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500;
        text-decoration: none; transition: border-color 0.2s, transform 0.15s;
        white-space: nowrap;
      }
      .nx-btn-ghost:hover { border-color: #3b82f6; transform: translateY(-1px); }
      .nx-section { padding: 120px 24px; }
      .nx-container { max-width: 1200px; margin: 0 auto; }
      .nx-container-narrow { max-width: 800px; margin: 0 auto; }
      .nx-label {
        font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500;
        letter-spacing: 0.12em; text-transform: uppercase; color: #3b82f6;
        margin-bottom: 16px;
      }
      .nx-h1 {
        font-family: 'Syne', sans-serif; font-size: clamp(42px, 7vw, 80px);
        font-weight: 800; line-height: 1.05; letter-spacing: -0.03em;
        color: #f5f5f5;
      }
      .nx-h2 {
        font-family: 'Syne', sans-serif; font-size: clamp(32px, 4.5vw, 52px);
        font-weight: 700; line-height: 1.1; letter-spacing: -0.025em; color: #f5f5f5;
      }
      .nx-body {
        font-family: 'DM Sans', sans-serif; font-size: 17px; line-height: 1.75;
        color: #a3a3a3;
      }
      .nx-grid-3 {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
      }
      @media (max-width: 900px) { .nx-grid-3 { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 560px) { .nx-grid-3 { grid-template-columns: 1fr; } }
      .nx-card {
        background: #141414; border: 1px solid #1a1a1a; border-radius: 12px;
        padding: 28px; transition: border-color 0.2s;
      }
      .nx-card:hover { border-color: #2a2a2a; }
      .nx-pricing-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-items: start;
      }
      @media (max-width: 900px) { .nx-pricing-grid { grid-template-columns: 1fr; } }
      .nx-pricing-card {
        background: #141414; border: 1px solid #1a1a1a; border-radius: 14px;
        padding: 36px; display: flex; flex-direction: column; gap: 20px;
      }
      .nx-pricing-card.featured {
        border-color: #3b82f6; background: #0d1829; position: relative;
      }
      .nx-trust-bar {
        background: #111111; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a;
        padding: 48px 24px;
      }
      .nx-trust-grid {
        display: grid; grid-template-columns: repeat(4, 1fr);
        max-width: 1000px; margin: 0 auto;
      }
      @media (max-width: 700px) { .nx-trust-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; } }
      .nx-trust-item { text-align: center; }
      .nx-trust-divider {
        border-left: 1px solid #1f1f1f;
      }
      @media (max-width: 700px) { .nx-trust-divider { border-left: none; } }
      .nx-mono { font-family: 'JetBrains Mono', monospace; }
      .nx-timeline-line {
        position: absolute; left: 19px; top: 40px; bottom: 0;
        width: 1px; background: #1f1f1f;
      }
      .nx-flow {
        display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      }
      .nx-flow-item {
        background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25);
        color: #10b981; border-radius: 6px;
        padding: 8px 14px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
      }
      .nx-flow-arrow { color: #374151; font-size: 18px; }
      .nx-badge {
        display: inline-block; background: #3b82f6; color: #fff;
        font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
        letter-spacing: 0.08em; text-transform: uppercase;
        padding: 4px 10px; border-radius: 4px; position: absolute; top: -14px; left: 50%;
        transform: translateX(-50%); white-space: nowrap;
      }
      .nx-founding-box {
        border: 1px solid rgba(16,185,129,0.3); background: rgba(16,185,129,0.04);
        border-radius: 12px; padding: 32px 36px; text-align: center; margin-top: 48px;
      }
    `;
    document.head.appendChild(style);

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
      document.head.removeChild(fontLink);
      document.head.removeChild(style);
    };
  }, []);

  const faqItems = [
    {
      q: "Is this white-label?",
      a: "Yes. Nexus is built as a white-label multi-tenant platform that supports multiple client websites and centralized management from one admin interface.",
    },
    {
      q: "Are the pages all the same template?",
      a: "No. Pages are assembled using service-level variation banks, blueprints, and multiple content sections designed to diversify output across service and location combinations.",
    },
    {
      q: "How do you control quality?",
      a: "The platform scores pages on a 0-100 scale, assigns tiers, flags thin content banks, supports bulk score and tier actions, and lets operators filter pages by score, tier, service, location, and blueprint.",
    },
    {
      q: "What happens after pages go live?",
      a: "Nexus auto-scores, auto-tiers, rebuilds sitemaps, submits Tier 1 URLs to Google's Indexing API, monitors fallback promotion candidates, and sends weekly summary emails.",
    },
    {
      q: "Can this support more than one client website?",
      a: "Yes. Multi-website support is built into the system. One account can manage multiple websites including main domains and subdomains.",
    },
    {
      q: "What if my client needs more than 1,000 pages?",
      a: "Add page blocks as needed. Regional coverage at 5,000 pages is +$500/mo. Statewide at 15,000 is +$1,500/mo. Nationwide at 50,000 is +$3,500/mo. All per site.",
    },
    {
      q: "Do I need to provide my own API keys or technical setup?",
      a: "No. Everything is included and managed. You bring the client, we handle the infrastructure.",
    },
    {
      q: "How long until pages start appearing in Google?",
      a: "Pages roll out over 90 days for safe indexing. Most agencies see Search Console impressions climbing by month 2–3. Tier 1 pages are submitted directly to Google's Indexing API for faster discovery.",
    },
  ];

  const features = [
    { icon: "◈", title: "Coverage at scale", desc: "Publish thousands of service-area pages without building them one by one." },
    { icon: "⬡", title: "Quality controls", desc: "Score pages, apply tiers, and filter weak content before broad promotion." },
    { icon: "⟳", title: "Built-in automation", desc: "Generation, sitemap updates, indexing, fallback monitoring, and reporting are already wired in." },
    { icon: "⇌", title: "Internal linking engine", desc: "Contextual links and hub-to-child page structures improve coverage and site architecture." },
    { icon: "◻", title: "White-label operations", desc: "One admin panel manages all client websites under one system." },
    { icon: "⊞", title: "Governed publishing", desc: "The platform gives operators control over what gets promoted, when, and how aggressively." },
  ];

  const steps = [
    {
      title: "Launch the client",
      desc: "We set up the client website, brand profile, services, industries, and locations inside the platform. Nexus supports multi-website accounts and account-level switching, so one agency can manage many client properties cleanly.",
    },
    {
      title: "Build the content engine",
      desc: "Each service gets its own variation bank with content health checks across 8 core sections. Thin or incomplete banks are flagged before they become a scale problem.",
    },
    {
      title: "Generate pages in bulk",
      desc: "Bulk jobs create service + location pages using blueprints and variation banks. The platform tracks generation progress, skips duplicate slugs, and auto-scores new pages after generation.",
    },
    {
      title: "Qualify pages before promotion",
      desc: "Pages are scored, tiered, and filtered by quality score, service, location, and blueprint. Tier-based controls let you promote stronger pages and keep weaker pages from being pushed too aggressively.",
    },
    {
      title: "Automate the SEO operations",
      desc: "Nexus handles sitemap regeneration, internal link rebuilding, hub linking, fallback promotion review, Google Indexing API submission for Tier 1 URLs, and weekly summary emails.",
    },
  ];

  const flowSteps = [
    "Score after generation",
    "Assign tiers after scoring",
    "Rebuild sitemaps after tier changes",
    "Promote qualified pages through indexing workflows",
    "Review fallback demand before scaling new URLs",
  ];

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#f5f5f5", overflowX: "hidden" }}>

      {/* ── NAV ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(10,10,10,0.85)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid #141414", padding: "0 24px",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em" }}>
            Nexus <span style={{ color: "#737373", fontWeight: 400 }}>by SpotOn</span>
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <a href="#how-it-works" style={{ color: "#737373", textDecoration: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }} className="nx-nav-link">How it works</a>
            <a href="#pricing" style={{ color: "#737373", textDecoration: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 14, marginLeft: 4 }}>Pricing</a>
            <a href={BOOKING_URL} className="nx-btn-primary" style={{ padding: "10px 20px", fontSize: 14, marginLeft: 8 }}>Book a call</a>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="nx-section" style={{ paddingTop: 140, paddingBottom: 120, textAlign: "center" }}>
        <div className="nx-container-narrow">
          <FadeIn>
            <div className="nx-label">Nexus by SpotOn</div>
          </FadeIn>
          <FadeIn delay={80}>
            <h1 className="nx-h1" style={{ marginBottom: 28 }}>
              Managed local SEO<br />
              <span style={{ color: "#3b82f6" }}>infrastructure</span> for agencies
            </h1>
          </FadeIn>
          <FadeIn delay={160}>
            <p className="nx-body" style={{ maxWidth: 620, margin: "0 auto 40px", fontSize: 18 }}>
              Launch and manage thousands of client service-area pages with built-in quality scoring,
              tiered promotion, automated sitemaps, internal linking, hub pages, and weekly reporting.
              <br /><br />
              Built for agencies that want more coverage, more control, and less SEO chaos.
            </p>
          </FadeIn>
          <FadeIn delay={220}>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={BOOKING_URL} className="nx-btn-primary" style={{ fontSize: 16, padding: "16px 36px" }}>
                Book a Strategy Call
              </a>
              <a href="#how-it-works" className="nx-btn-ghost" style={{ fontSize: 16 }}>
                See the Rollout Model
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <div className="nx-trust-bar">
        <div className="nx-trust-grid">
          {[
            { num: "1.5M+", label: "published pages" },
            { num: "8", label: "automated SEO workflows" },
            { num: "50,000", label: "max pages per client site" },
            { num: "$1/page", label: "at no-brainer bundle rate" },
          ].map((stat, i) => (
            <div key={i} className={`nx-trust-item${i > 0 ? " nx-trust-divider" : ""}`} style={{ padding: "0 24px" }}>
              <div className="nx-mono" style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 500, color: "#f5f5f5", marginBottom: 6 }}>
                {stat.num}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#737373" }}>
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
            <div className="nx-label">The problem</div>
            <h2 className="nx-h2" style={{ marginBottom: 36 }}>Agencies hit a growth wall</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="nx-body" style={{ marginBottom: 36 }}>
              Most agencies can sell SEO. Few can deliver high-volume local coverage without hiring a lot more people or
              shipping risky, thin template pages. Google is harder on scaled low-value content, and manual page
              production is too slow to win the long tail.
            </p>
          </FadeIn>
          <FadeIn delay={140}>
            <div style={{
              background: "#111111", border: "1px solid #1a1a1a", borderRadius: 12,
              padding: "36px 48px", textAlign: "left", display: "inline-block", maxWidth: 560,
            }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "#737373", marginBottom: 20 }}>
                That creates a bad choice:
              </p>
              {["Stay small and manual", "Or scale fast and get messy"].map((line, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span style={{ color: "#ef4444", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }}>→</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "#d4d4d4" }}>{line}</span>
                </div>
              ))}
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #1f1f1f" }}>
                <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, color: "#f5f5f5" }}>
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
            <div className="nx-label">The solution</div>
            <h2 className="nx-h2" style={{ marginBottom: 36 }}>What Nexus does</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="nx-body">
              Nexus is a white-label SEO publishing system that generates, organizes, scores, and manages large numbers
              of service-area pages per client website. Each page is tied to a real service + location combination,
              then controlled through scoring, tiers, sitemap inclusion, hub pages, internal links, and automations.
            </p>
            <p className="nx-body" style={{ marginTop: 20 }}>
              Instead of blasting every page equally, Nexus controls which pages are generated, which are promoted,
              and which are held back. That is what makes it operationally powerful and safer than basic mass-page systems.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="how-it-works">
        <div className="nx-container" style={{ maxWidth: 860, margin: "0 auto" }}>
          <FadeIn>
            <div className="nx-label" style={{ textAlign: "center" }}>Process</div>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 72 }}>How it works</h2>
          </FadeIn>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {steps.map((step, i) => (
              <FadeIn key={i} delay={i * 80}>
                <div style={{ display: "flex", gap: 28, paddingBottom: i < steps.length - 1 ? 48 : 0, position: "relative" }}>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: "#0d1829", border: "2px solid #3b82f6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#3b82f6", fontWeight: 500,
                      flexShrink: 0,
                    }}>
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    {i < steps.length - 1 && (
                      <div style={{ width: 1, flex: 1, background: "#1f1f1f", marginTop: 8 }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: i < steps.length - 1 ? 8 : 0 }}>
                    <h3 style={{
                      fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700,
                      color: "#f5f5f5", marginBottom: 10, paddingTop: 8,
                    }}>
                      {step.title}
                    </h3>
                    <p className="nx-body" style={{ fontSize: 16 }}>{step.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY NEXUS ── */}
      <section className="nx-section" style={{ paddingTop: 0 }}>
        <div className="nx-container">
          <FadeIn>
            <div className="nx-label" style={{ textAlign: "center" }}>Why Nexus</div>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 56 }}>Built different. Operated differently.</h2>
          </FadeIn>
          <div className="nx-grid-3">
            {features.map((f, i) => (
              <FadeIn key={i} delay={i * 60}>
                <div className="nx-card">
                  <div style={{ fontSize: 28, marginBottom: 16, color: "#3b82f6" }}>{f.icon}</div>
                  <h3 style={{
                    fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700,
                    color: "#f5f5f5", marginBottom: 10,
                  }}>{f.title}</h3>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: "#737373", lineHeight: 1.65 }}>
                    {f.desc}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SAFETY ── */}
      <section className="nx-section" style={{ paddingTop: 0 }}>
        <div className="nx-container-narrow" style={{ textAlign: "center" }}>
          <FadeIn>
            <div className="nx-label">Safety by design</div>
            <h2 className="nx-h2" style={{ marginBottom: 36 }}>Built to scale without acting reckless</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <p className="nx-body" style={{ marginBottom: 56 }}>
              Nexus is not a spray-and-pray page generator. The platform includes quality scoring, tier-based page
              control, thin-bank detection, promotion queues, auto-demotion for weak Tier 1 pages, and configurable
              automation thresholds.
            </p>
          </FadeIn>
          <FadeIn delay={140}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              {flowSteps.map((step, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div className="nx-flow-item">{step}</div>
                  {i < flowSteps.length - 1 && (
                    <div style={{ color: "#374151", fontSize: 18, lineHeight: 1 }}>↓</div>
                  )}
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="pricing">
        <div className="nx-container">
          <FadeIn>
            <div className="nx-label" style={{ textAlign: "center" }}>Pricing</div>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 16 }}>Straightforward. No surprises.</h2>
            <p className="nx-body" style={{ textAlign: "center", marginBottom: 64 }}>
              Every plan includes full platform access, white-label operations, and all automation workflows.
            </p>
          </FadeIn>

          <div className="nx-pricing-grid">
            {/* No-Brainer Bundle */}
            <FadeIn delay={0}>
              <div className="nx-pricing-card featured" style={{ gridColumn: "span 1" }}>
                <span className="nx-badge">Most Popular</span>
                <div>
                  <div className="nx-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "#3b82f6", textTransform: "uppercase", marginBottom: 8 }}>The No-Brainer Bundle</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 800, color: "#f5f5f5", lineHeight: 1 }}>
                    $3,000<span style={{ fontSize: 18, color: "#737373", fontWeight: 400 }}>/mo</span>
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#737373", marginTop: 6 }}>
                    Annual: $2,500/mo &bull; 3-month minimum
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    "3 client websites",
                    "Up to 1,000 pages per site, rolled out over 90 days",
                    "Proprietary content engine with service-specific variation banks",
                    "Quality scoring and tiering — only qualified pages are promoted",
                    "Full automation: scoring, tiering, sitemaps, internal linking, hub pages, fallback monitoring, weekly reporting",
                    "Setup: $1,500 per client site",
                  ].map((item, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#d4d4d4" }}>
                      <span style={{ color: "#10b981", flexShrink: 0, marginTop: 2 }}>✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div style={{ borderTop: "1px solid #1f3a5f", paddingTop: 16 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#737373", marginBottom: 8 }}>Growth Add-Ons (per site):</div>
                  {[
                    ["5,000 pages (regional)", "+$500/mo"],
                    ["15,000 pages (statewide)", "+$1,500/mo"],
                    ["50,000 pages (nationwide)", "+$3,500/mo"],
                  ].map(([label, price], i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#a3a3a3", marginBottom: 4 }}>
                      <span>{label}</span>
                      <span className="nx-mono" style={{ color: "#3b82f6" }}>{price}</span>
                    </div>
                  ))}
                </div>
                <a href={BOOKING_URL} className="nx-btn-primary" style={{ textAlign: "center", marginTop: "auto" }}>
                  Get started
                </a>
              </div>
            </FadeIn>

            {/* Growth */}
            <FadeIn delay={80}>
              <div className="nx-pricing-card">
                <div>
                  <div className="nx-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "#737373", textTransform: "uppercase", marginBottom: 8 }}>Scale Tier</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 800, color: "#f5f5f5", lineHeight: 1 }}>
                    $7,500<span style={{ fontSize: 18, color: "#737373", fontWeight: 400 }}>/mo</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    "10 client websites",
                    "5,000 pages per site included",
                    "White-label dashboard",
                    "Monthly strategy call",
                    "Setup: $1,500/site",
                  ].map((item, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#d4d4d4" }}>
                      <span style={{ color: "#10b981", flexShrink: 0, marginTop: 2 }}>✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 16 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#737373" }}>
                    Extra client site: +$1,000/mo + $1,500 setup
                  </div>
                </div>
                <a href={BOOKING_URL} className="nx-btn-ghost" style={{ textAlign: "center", marginTop: "auto" }}>
                  Book a call
                </a>
              </div>
            </FadeIn>

            {/* Enterprise */}
            <FadeIn delay={160}>
              <div className="nx-pricing-card">
                <div>
                  <div className="nx-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "#737373", textTransform: "uppercase", marginBottom: 8 }}>Enterprise</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, color: "#f5f5f5", lineHeight: 1.1 }}>
                    Starting at<br />
                    <span style={{ fontSize: 42 }}>$15,000</span>
                    <span style={{ fontSize: 18, color: "#737373", fontWeight: 400 }}>/mo</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    "Unlimited sites",
                    "Up to 50,000 pages per site",
                    "Dedicated infrastructure",
                    "Custom blueprints",
                    "Quarterly business review",
                  ].map((item, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#d4d4d4" }}>
                      <span style={{ color: "#10b981", flexShrink: 0, marginTop: 2 }}>✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <a href={BOOKING_URL} className="nx-btn-ghost" style={{ textAlign: "center", marginTop: "auto" }}>
                  Let's talk
                </a>
              </div>
            </FadeIn>
          </div>

          {/* Founding offer */}
          <FadeIn delay={200}>
            <div className="nx-founding-box">
              <div className="nx-mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "#10b981", textTransform: "uppercase", marginBottom: 12 }}>
                Founding Agency Offer — First 5 agencies only
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "#d4d4d4", lineHeight: 1.65 }}>
                Setup reduced to <strong style={{ color: "#10b981" }}>$500/site</strong>. 6-month commitment required.
                Case study and testimonial rights.
              </p>
              <a href={BOOKING_URL} className="nx-btn-primary" style={{ marginTop: 20, fontSize: 14, padding: "12px 28px" }}>
                Claim a founding spot
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="nx-section" style={{ paddingTop: 0 }} id="faq">
        <div className="nx-container" style={{ maxWidth: 820, margin: "0 auto" }}>
          <FadeIn>
            <div className="nx-label" style={{ textAlign: "center" }}>FAQ</div>
            <h2 className="nx-h2" style={{ textAlign: "center", marginBottom: 56 }}>Common questions</h2>
          </FadeIn>
          <FadeIn delay={80}>
            <Accordion items={faqItems} />
          </FadeIn>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="nx-section" style={{ paddingTop: 0, paddingBottom: 160, textAlign: "center" }}>
        <div className="nx-container-narrow">
          <FadeIn>
            <h2 className="nx-h2" style={{ marginBottom: 28 }}>
              Stop selling SEO<br />
              <span style={{ color: "#3b82f6" }}>that can't scale</span>
            </h2>
            <p className="nx-body" style={{ marginBottom: 40, fontSize: 18 }}>
              If your agency already sells SEO, Nexus gives you the operating system to deliver larger coverage,
              cleaner workflows, and a more defensible offer.
            </p>
            <a href={BOOKING_URL} className="nx-btn-primary" style={{ fontSize: 17, padding: "18px 44px" }}>
              Book a Strategy Call
            </a>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#525252", marginTop: 20 }}>
              We'll map your first 3 client sites, rollout plan, and page targets.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: "1px solid #141414", padding: "32px 24px",
        display: "flex", justifyContent: "center", alignItems: "center",
        flexWrap: "wrap", gap: 16,
      }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#525252" }}>
          © {new Date().getFullYear()} SpotOn Results. All rights reserved.
        </span>
        <span style={{ color: "#1f1f1f" }}>·</span>
        <a href="mailto:hello@spotonnexus.com" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#525252", textDecoration: "none" }}>
          hello@spotonnexus.com
        </a>
      </footer>
    </div>
  );
}
