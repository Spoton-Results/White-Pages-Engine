import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";

const PHONE_DISPLAY = "(844) 723-1900";
const PHONE_TEL = "+18447231900";

const COLORS = {
  bg: "#09090b",
  text: "#fafafa",
  muted: "#a1a1aa",
  dim: "#52525b",
  accent: "#3b82f6",
  card: "#18181b",
  border: "#27272a",
  error: "#ef4444",
  success: "#10b981",
};

const FONT_HEAD = "'Satoshi', 'Syne', sans-serif";
const FONT_BODY = "'Plus Jakarta Sans', 'DM Sans', sans-serif";

const US_STATES: { code: string; name: string }[] = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],
  ["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],
  ["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],
  ["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],
  ["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],
  ["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
].map(([code, name]) => ({ code, name }));

const INDUSTRIES = [
  "HVAC","Plumbing","Roofing","Electrical","Landscaping","General Contractor",
  "Legal","Dental","Medical","Real Estate","Restaurant","Auto Repair",
  "Pest Control","Cleaning","Moving","Insurance","Financial Services",
  "Merchant Services","Other",
];

const INDUSTRY_SERVICES: Record<string, string[]> = {
  HVAC: ["AC Repair","AC Installation","Furnace Repair","Furnace Installation","Heat Pump Services","Ductwork Installation","Ductwork Cleaning","HVAC Maintenance Plans","Emergency HVAC Repair","Commercial HVAC","Thermostat Installation","Indoor Air Quality","Mini Split Installation","HVAC System Replacement","Refrigerant Recharge"],
  Plumbing: ["Drain Cleaning","Water Heater Repair","Water Heater Installation","Sewer Line Repair","Pipe Repair","Leak Detection","Toilet Repair","Faucet Installation","Garbage Disposal Repair","Sump Pump Installation","Water Softener Installation","Emergency Plumbing","Commercial Plumbing","Gas Line Repair","Bathroom Remodeling"],
  Roofing: ["Roof Repair","Roof Replacement","Roof Inspection","Shingle Roofing","Metal Roofing","Flat Roof Repair","Commercial Roofing","Roof Leak Repair","Gutter Installation","Gutter Repair","Storm Damage Repair","Roof Maintenance","Skylight Installation","Roof Ventilation","Emergency Roof Repair"],
  Electrical: ["Electrical Repair","Electrical Panel Upgrade","Outlet Installation","Ceiling Fan Installation","Lighting Installation","Wiring Repair","Generator Installation","EV Charger Installation","Smoke Detector Installation","Commercial Electrical","Electrical Inspection","Surge Protection","Landscape Lighting","Emergency Electrical","Smart Home Wiring"],
  Landscaping: ["Lawn Care","Landscape Design","Tree Trimming","Tree Removal","Sprinkler Installation","Sprinkler Repair","Sod Installation","Mulching","Hardscaping","Patio Installation","Retaining Walls","Drainage Solutions","Commercial Landscaping","Snow Removal","Yard Cleanup"],
  "General Contractor": ["Home Remodeling","Kitchen Remodeling","Bathroom Remodeling","Room Additions","Deck Building","Fence Installation","Concrete Work","Drywall Repair","Painting","Flooring Installation","Window Installation","Door Installation","Basement Finishing","Garage Construction","Commercial Construction"],
  Legal: ["Personal Injury","Car Accident Lawyer","Workers Compensation","Criminal Defense","DUI Defense","Family Law","Divorce Attorney","Estate Planning","Bankruptcy Attorney","Business Law","Immigration Attorney","Employment Law","Real Estate Attorney","Medical Malpractice","Slip and Fall Attorney"],
  Dental: ["General Dentistry","Teeth Cleaning","Dental Implants","Teeth Whitening","Invisalign","Root Canal","Dental Crowns","Dental Veneers","Emergency Dentist","Pediatric Dentist","Cosmetic Dentistry","Dental Bridges","Tooth Extraction","Dentures","Dental Exam"],
  Medical: ["Primary Care","Urgent Care","Family Medicine","Internal Medicine","Pediatrics","Dermatology","Orthopedics","Physical Therapy","Chiropractic","Mental Health","Telehealth","Weight Loss","Pain Management","Sports Medicine","Allergy Treatment"],
  "Real Estate": ["Homes for Sale","Buying a Home","Selling a Home","Real Estate Agent","Property Management","Commercial Real Estate","Luxury Homes","First Time Home Buyer","Home Valuation","Foreclosures","New Construction Homes","Condos for Sale","Investment Properties","Relocation Services","Open Houses"],
  Restaurant: ["Catering Services","Private Dining","Online Ordering","Delivery Service","Takeout Menu","Happy Hour","Brunch Service","Event Hosting","Group Dining","Corporate Catering","Wedding Catering","Food Truck Service","Meal Prep","Gift Cards","Loyalty Program"],
  "Auto Repair": ["Oil Change","Brake Repair","Engine Repair","Transmission Repair","Tire Service","AC Repair","Battery Replacement","Exhaust Repair","Suspension Repair","Wheel Alignment","Auto Electrical","Check Engine Light","Smog Check","Fleet Service","Emergency Towing"],
  "Pest Control": ["Termite Treatment","Ant Control","Roach Control","Bed Bug Treatment","Rodent Control","Mosquito Control","Wasp Removal","Spider Control","Wildlife Removal","Commercial Pest Control","Fumigation","Lawn Pest Control","Flea Treatment","Tick Control","Preventive Pest Control"],
  Cleaning: ["House Cleaning","Deep Cleaning","Move In Cleaning","Move Out Cleaning","Office Cleaning","Commercial Cleaning","Carpet Cleaning","Window Cleaning","Pressure Washing","Post Construction Cleaning","Janitorial Services","Floor Waxing","Upholstery Cleaning","Sanitization Services","Green Cleaning"],
  Moving: ["Local Moving","Long Distance Moving","Commercial Moving","Office Moving","Packing Services","Loading and Unloading","Furniture Moving","Piano Moving","Storage Solutions","Senior Moving","Military Moving","Same Day Moving","Apartment Moving","Interstate Moving","Moving Supplies"],
  Insurance: ["Auto Insurance","Home Insurance","Life Insurance","Health Insurance","Business Insurance","Renters Insurance","Motorcycle Insurance","Boat Insurance","Umbrella Insurance","Workers Compensation Insurance","Commercial Auto Insurance","Liability Insurance","Flood Insurance","SR22 Insurance","Insurance Quotes"],
  "Financial Services": ["Tax Preparation","Bookkeeping","Payroll Services","Business Consulting","Financial Planning","Retirement Planning","Investment Management","Debt Consolidation","Credit Repair","Mortgage Lending","Business Loans","Wealth Management","Estate Planning","Tax Resolution","Accounting Services"],
  "Merchant Services": ["Credit Card Processing","Payment Processing","POS Systems","Mobile Payments","Cash Discount Programs","No Fee Processing","Restaurant Payment Solutions","Retail Merchant Services","eCommerce Payment Processing","High Risk Merchant Services","Same Day Funding","Contactless Payments","Invoice Payments","Recurring Billing","Payment Gateway"],
  Other: [],
};

const PLAN_LABEL: Record<string, string> = {
  local_launch: "Local Launch ($1,997/mo)",
  growth_bundle: "Growth Bundle ($3,000/mo)",
  growth_bundle_annual: "Growth Bundle Annual ($2,500/mo)",
  addon_site: "Additional Site ($1,000/mo)",
  custom: "Custom Plan",
};

type CoverageLevel = "regional" | "statewide" | "multi_state" | "national";
type CitySize = "major" | "medium_and_major" | "all_cities";

interface BusinessData {
  legal_name: string;
  brand_name: string;
  domain: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  industry: string;
  tagline: string;
  brand_color: string;
}

interface ServiceItem {
  id: string;
  name: string;
  checked: boolean;
}

interface CoverageData {
  level: CoverageLevel;
  states: string[];
  city_size: CitySize;
}

type LookupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "submitted" }
  | { kind: "in_progress"; status: string }
  | { kind: "ready"; planType: string };

// ─── Styles ──────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  padding: "12px 14px",
  background: COLORS.card,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  color: COLORS.text,
  fontSize: 15,
  fontFamily: FONT_BODY,
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: COLORS.text,
  marginBottom: 8,
};
const helperStyle: React.CSSProperties = {
  fontSize: 12,
  color: COLORS.muted,
  marginTop: 6,
};
const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: COLORS.error,
  marginTop: 6,
};
const fieldGroup: React.CSSProperties = { marginBottom: 24 };

function Btn({ children, onClick, primary, disabled, full, testId }: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  full?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        minHeight: 48,
        padding: "0 28px",
        width: full ? "100%" : undefined,
        background: primary ? COLORS.accent : "transparent",
        color: primary ? "#fff" : COLORS.text,
        border: primary ? "none" : `1px solid ${COLORS.border}`,
        borderRadius: 8,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: FONT_BODY,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        boxShadow: primary && !disabled ? "0 4px 20px rgba(59,130,246,0.35)" : undefined,
        transition: "background 0.2s, opacity 0.2s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function OnboardForm() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setLookup({ kind: "error", message: "Missing token in URL." });
      return;
    }
    (async () => {
      try {
        const r = await fetch(`/api/onboard/lookup/${encodeURIComponent(token)}`);
        if (r.status === 404) {
          setLookup({ kind: "error", message: "This onboarding link is invalid or expired." });
          return;
        }
        if (!r.ok) {
          setLookup({ kind: "error", message: "We couldn't load your onboarding link. Please try again in a moment." });
          return;
        }
        const data = await r.json();
        if (data.status === "submitted") {
          setLookup({ kind: "submitted" });
        } else if (data.status === "pending") {
          setLookup({ kind: "ready", planType: data.plan_type || "custom" });
        } else {
          setLookup({ kind: "in_progress", status: data.status || "processing" });
        }
      } catch {
        setLookup({ kind: "error", message: "Network error. Please try again." });
      }
    })();
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: FONT_BODY }}>
      <style>{`
        input::placeholder, select::placeholder { color: ${COLORS.dim}; }
        input:focus, select:focus, textarea:focus { border-color: ${COLORS.accent} !important; }
        @keyframes nx-spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) {
          .nx-row-2 { grid-template-columns: 1fr !important; }
          .nx-nav-buttons { flex-direction: column-reverse; gap: 12px; }
          .nx-nav-buttons button { width: 100%; }
        }
      `}</style>

      {lookup.kind === "loading" && <CenteredMessage spinner>Loading your onboarding…</CenteredMessage>}

      {lookup.kind === "error" && (
        <CenteredMessage>
          <h1 style={h1Style}>We couldn't load this link</h1>
          <p style={pStyle}>
            {lookup.message} If you just completed payment, please check your email or call{" "}
            <a href={`tel:${PHONE_TEL}`} style={linkStyle}>{PHONE_DISPLAY}</a>.
          </p>
        </CenteredMessage>
      )}

      {lookup.kind === "submitted" && (
        <CenteredMessage>
          <h1 style={h1Style}>Your onboarding has been submitted</h1>
          <p style={pStyle}>We are setting up your account. You will receive an email when your pages are ready.</p>
          <p style={{ ...pStyle, marginTop: 24, fontSize: 14 }}>
            Questions? Call <a href={`tel:${PHONE_TEL}`} style={linkStyle}>{PHONE_DISPLAY}</a>
          </p>
        </CenteredMessage>
      )}

      {lookup.kind === "in_progress" && (
        <CenteredMessage>
          <h1 style={h1Style}>Your account is being processed</h1>
          <p style={pStyle}>Current status: <strong style={{ color: COLORS.text }}>{lookup.status}</strong></p>
          <p style={{ ...pStyle, marginTop: 24, fontSize: 14 }}>
            Questions? Call <a href={`tel:${PHONE_TEL}`} style={linkStyle}>{PHONE_DISPLAY}</a>
          </p>
        </CenteredMessage>
      )}

      {lookup.kind === "ready" && <Wizard token={token} planType={lookup.planType} />}
    </div>
  );
}

const h1Style: React.CSSProperties = {
  fontFamily: FONT_HEAD, fontSize: "clamp(26px,4vw,36px)", fontWeight: 900,
  letterSpacing: "-0.02em", marginBottom: 16, color: COLORS.text,
};
const pStyle: React.CSSProperties = { fontSize: 16, color: COLORS.muted, lineHeight: 1.6 };
const linkStyle: React.CSSProperties = { color: COLORS.accent, textDecoration: "none" };

function CenteredMessage({ children, spinner }: { children: React.ReactNode; spinner?: boolean }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 24px", textAlign: "center",
    }}>
      <div style={{ maxWidth: 560 }}>
        {spinner && (
          <div style={{
            width: 36, height: 36, border: `3px solid ${COLORS.border}`,
            borderTopColor: COLORS.accent, borderRadius: "50%",
            margin: "0 auto 24px", animation: "nx-spin 0.9s linear infinite",
          }} />
        )}
        {children}
      </div>
    </div>
  );
}

// ─── Wizard ──────────────────────────────────────────────────────────────────
function Wizard({ token, planType }: { token: string; planType: string }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [business, setBusiness] = useState<BusinessData>({
    legal_name: "", brand_name: "", domain: "", phone: "", email: "",
    city: "", state: "", industry: "", tagline: "", brand_color: "#3b82f6",
  });
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [coverage, setCoverage] = useState<CoverageData>({
    level: "regional", states: [], city_size: "medium_and_major",
  });

  const goto = (n: 1 | 2 | 3 | 4 | 5) => {
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onStep1Next = (data: BusinessData) => {
    setBusiness(data);
    // Initialize services from industry mapping
    const suggested = INDUSTRY_SERVICES[data.industry] || [];
    setServices(suggested.map((name, i) => ({ id: `s_${i}`, name, checked: true })));
    // Initialize coverage states with primary state
    setCoverage((c) => ({ ...c, states: c.states.length === 0 ? [data.state] : Array.from(new Set([data.state, ...c.states])) }));
    goto(2);
  };

  const onStep2Next = (s: ServiceItem[]) => { setServices(s); goto(3); };
  const onStep3Next = (c: CoverageData) => { setCoverage(c); goto(4); };

  const onSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const checkedServices = services.filter((s) => s.checked && s.name.trim()).map((s) => s.name.trim());
      const r = await fetch("/api/onboard/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, business, services: checkedServices, coverage }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) {
        setSubmitError(data.error || "Submission failed. Please try again.");
        setSubmitting(false);
        return;
      }
      goto(5);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 80px" }}>
      <ProgressBar step={step} />

      {step === 1 && <Step1 initial={business} onNext={onStep1Next} />}
      {step === 2 && (
        <Step2
          industry={business.industry}
          services={services}
          setServices={setServices}
          onBack={() => goto(1)}
          onNext={onStep2Next}
        />
      )}
      {step === 3 && (
        <Step3
          business={business}
          coverage={coverage}
          servicesCount={services.filter((s) => s.checked).length}
          onBack={() => goto(2)}
          onNext={onStep3Next}
        />
      )}
      {step === 4 && (
        <Step4
          token={token}
          planType={planType}
          business={business}
          services={services.filter((s) => s.checked && s.name.trim()).map((s) => s.name.trim())}
          coverage={coverage}
          servicesCount={services.filter((s) => s.checked).length}
          onEdit={(s) => goto(s)}
          onSubmit={onSubmit}
          submitting={submitting}
          submitError={submitError}
        />
      )}
      {step === 5 && <Step5Confirm email={business.email} />}
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────
function ProgressBar({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  if (step === 5) return null;
  const steps = [
    { n: 1, label: "Business Info" },
    { n: 2, label: "Services" },
    { n: 3, label: "Coverage" },
    { n: 4, label: "Review" },
  ];
  return (
    <div style={{
      position: "sticky", top: 0, background: COLORS.bg, zIndex: 10,
      padding: "12px 0 24px", marginBottom: 16,
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ display: "flex", gap: 8 }}>
        {steps.map((s) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div key={s.n} style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                height: 4, borderRadius: 2,
                background: done || active ? COLORS.accent : COLORS.border,
                marginBottom: 8,
              }} />
              <div style={{
                fontSize: 11, color: active ? COLORS.text : COLORS.muted,
                fontWeight: active ? 700 : 500,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {done && <span style={{ color: COLORS.success }}>✓</span>}
                Step {s.n}: {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STEP 1 ──────────────────────────────────────────────────────────────────
function Step1({ initial, onNext }: { initial: BusinessData; onNext: (d: BusinessData) => void }) {
  const [d, setD] = useState<BusinessData>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessData, string>>>({});

  const validate = (): boolean => {
    const e: Partial<Record<keyof BusinessData, string>> = {};
    if (d.legal_name.trim().length < 2) e.legal_name = "Must be at least 2 characters";
    let domain = d.domain.trim().replace(/^https?:\/\//i, "");
    if (!domain.includes(".") || /\s/.test(domain)) e.domain = "Enter a valid domain like example.com";
    if (d.phone.replace(/\D/g, "").length < 10) e.phone = "Enter at least 10 digits";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.email = "Enter a valid email address";
    if (!d.city.trim()) e.city = "Required";
    if (!d.state) e.state = "Required";
    if (!d.industry) e.industry = "Required";
    if (d.tagline.length > 120) e.tagline = "Maximum 120 characters";
    setErrors(e);
    if (Object.keys(e).length === 0) {
      onNext({ ...d, domain });
      return true;
    }
    return false;
  };

  const set = <K extends keyof BusinessData>(k: K, v: BusinessData[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => { const { [k]: _, ...rest } = prev; return rest; });
  };

  return (
    <div>
      <h1 style={h1Style}>Tell us about your business</h1>
      <p style={{ ...pStyle, marginBottom: 32 }}>This is the foundation for everything we publish.</p>

      <div style={fieldGroup}>
        <label style={labelStyle}>Business legal name *</label>
        <input style={inputStyle} type="text" value={d.legal_name}
          onChange={(e) => set("legal_name", e.target.value)}
          placeholder="e.g. Denver Plumbing Pros LLC"
          data-testid="input-legal-name" />
        {errors.legal_name && <div style={errorStyle} data-testid="error-legal-name">{errors.legal_name}</div>}
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Brand name if different</label>
        <input style={inputStyle} type="text" value={d.brand_name}
          onChange={(e) => set("brand_name", e.target.value)}
          placeholder="e.g. Denver Plumbing Pros"
          data-testid="input-brand-name" />
        <div style={helperStyle}>Leave blank if same as legal name</div>
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Primary domain for pages *</label>
        <input style={inputStyle} type="text" value={d.domain}
          onChange={(e) => set("domain", e.target.value.replace(/^https?:\/\//i, ""))}
          placeholder="e.g. denverplumbingpros.com"
          data-testid="input-domain" />
        <div style={helperStyle}>The domain where your Nexus pages will be published</div>
        {errors.domain && <div style={errorStyle} data-testid="error-domain">{errors.domain}</div>}
      </div>

      <div className="nx-row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Business phone *</label>
          <input style={inputStyle} type="tel" value={d.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="e.g. (303) 555-0100"
            data-testid="input-phone" />
          {errors.phone && <div style={errorStyle} data-testid="error-phone">{errors.phone}</div>}
        </div>
        <div>
          <label style={labelStyle}>Business email *</label>
          <input style={inputStyle} type="email" value={d.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="e.g. info@denverplumbingpros.com"
            data-testid="input-email" />
          {errors.email && <div style={errorStyle} data-testid="error-email">{errors.email}</div>}
        </div>
      </div>

      <div className="nx-row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Primary city *</label>
          <input style={inputStyle} type="text" value={d.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="e.g. Denver"
            data-testid="input-city" />
          {errors.city && <div style={errorStyle} data-testid="error-city">{errors.city}</div>}
        </div>
        <div>
          <label style={labelStyle}>Primary state *</label>
          <select style={inputStyle} value={d.state}
            onChange={(e) => set("state", e.target.value)}
            data-testid="select-state">
            <option value="">Select state</option>
            {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
          {errors.state && <div style={errorStyle} data-testid="error-state">{errors.state}</div>}
        </div>
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Industry *</label>
        <select style={inputStyle} value={d.industry}
          onChange={(e) => set("industry", e.target.value)}
          data-testid="select-industry">
          <option value="">Select industry</option>
          {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        {errors.industry && <div style={errorStyle} data-testid="error-industry">{errors.industry}</div>}
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Tagline</label>
        <input style={inputStyle} type="text" value={d.tagline} maxLength={120}
          onChange={(e) => set("tagline", e.target.value)}
          placeholder="e.g. Denver's Most Trusted Plumbing Team Since 2005"
          data-testid="input-tagline" />
        <div style={helperStyle}>{d.tagline.length}/120 characters</div>
        {errors.tagline && <div style={errorStyle}>{errors.tagline}</div>}
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Brand primary color</label>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input type="color" value={d.brand_color}
            onChange={(e) => set("brand_color", e.target.value)}
            data-testid="input-color"
            style={{ width: 56, height: 48, border: `1px solid ${COLORS.border}`, borderRadius: 8, background: COLORS.card, padding: 4, cursor: "pointer" }} />
          <input type="text" value={d.brand_color}
            onChange={(e) => set("brand_color", e.target.value)}
            placeholder="#3b82f6"
            data-testid="input-color-hex"
            style={{ ...inputStyle, flex: 1 }} />
        </div>
        <div style={helperStyle}>Used for CTA buttons and accents on your pages</div>
      </div>

      <div className="nx-nav-buttons" style={{ display: "flex", justifyContent: "flex-end", marginTop: 32 }}>
        <Btn primary onClick={validate} testId="button-step1-next">Next →</Btn>
      </div>
    </div>
  );
}

// ─── STEP 2 ──────────────────────────────────────────────────────────────────
function Step2({ industry, services, setServices, onBack, onNext }: {
  industry: string;
  services: ServiceItem[];
  setServices: (s: ServiceItem[]) => void;
  onBack: () => void;
  onNext: (s: ServiceItem[]) => void;
}) {
  const [loading, setLoading] = useState(services.length === 0 && industry !== "Other");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => setLoading(false), 600);
      return () => clearTimeout(t);
    }
  }, [loading]);

  const checkedCount = services.filter((s) => s.checked).length;

  const update = (id: string, patch: Partial<ServiceItem>) => {
    setServices(services.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const remove = (id: string) => setServices(services.filter((s) => s.id !== id));
  const add = () => {
    if (services.length >= 75) return;
    setServices([...services, { id: `s_${Date.now()}_${Math.random()}`, name: "", checked: true }]);
  };

  const next = () => {
    const valid = services.filter((s) => s.checked && s.name.trim());
    if (valid.length < 3) {
      setError("Please select or add at least 3 services to continue.");
      return;
    }
    setError(null);
    onNext(services);
  };

  return (
    <div>
      <h1 style={h1Style}>Pick your services</h1>
      <p style={{ ...pStyle, marginBottom: 24 }}>
        We've suggested {INDUSTRY_SERVICES[industry]?.length || 0} services based on your industry.
        Uncheck any that don't apply, edit names, or add your own.
      </p>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{
            width: 36, height: 36, border: `3px solid ${COLORS.border}`,
            borderTopColor: COLORS.accent, borderRadius: "50%",
            margin: "0 auto 16px", animation: "nx-spin 0.9s linear infinite",
          }} />
          <p style={{ color: COLORS.muted, fontSize: 14 }}>Generating service suggestions…</p>
        </div>
      )}

      {!loading && (
        <>
          <div style={{
            background: COLORS.card, border: `1px solid ${COLORS.border}`,
            borderRadius: 12, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12, padding: "0 4px" }}>
              <span data-testid="text-services-count">{checkedCount}</span> of {services.length} services selected
            </div>
            {services.map((s) => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 4px", borderBottom: `1px solid ${COLORS.bg}`,
              }}>
                <input type="checkbox" checked={s.checked}
                  onChange={(e) => update(s.id, { checked: e.target.checked })}
                  data-testid={`checkbox-service-${s.id}`}
                  style={{ width: 20, height: 20, accentColor: COLORS.accent, cursor: "pointer", flexShrink: 0 }} />
                <input type="text" value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                  placeholder="Service name"
                  data-testid={`input-service-${s.id}`}
                  style={{ ...inputStyle, minHeight: 40, padding: "8px 10px", flex: 1, fontSize: 14 }} />
                <button type="button" onClick={() => remove(s.id)}
                  data-testid={`button-remove-service-${s.id}`}
                  style={{
                    width: 32, height: 32, borderRadius: 6, border: "none",
                    background: "transparent", color: COLORS.muted, fontSize: 18,
                    cursor: "pointer", flexShrink: 0,
                  }} aria-label="Remove">×</button>
              </div>
            ))}
            {services.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: COLORS.muted, fontSize: 14 }}>
                No services yet. Add your first one below.
              </div>
            )}
          </div>

          <Btn onClick={add} disabled={services.length >= 75} testId="button-add-service">
            + Add another service
          </Btn>
          {services.length >= 75 && (
            <div style={{ ...helperStyle, marginTop: 8 }}>Maximum of 75 services reached.</div>
          )}

          {error && <div style={{ ...errorStyle, marginTop: 16, fontSize: 14 }} data-testid="error-services">{error}</div>}

          <div className="nx-nav-buttons" style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
            <Btn onClick={onBack} testId="button-step2-back">← Back</Btn>
            <Btn primary onClick={next} testId="button-step2-next">Next →</Btn>
          </div>
        </>
      )}
    </div>
  );
}

// ─── STEP 3 ──────────────────────────────────────────────────────────────────
function Step3({ business, coverage, servicesCount, onBack, onNext }: {
  business: BusinessData;
  coverage: CoverageData;
  servicesCount: number;
  onBack: () => void;
  onNext: (c: CoverageData) => void;
}) {
  const [c, setC] = useState<CoverageData>(coverage);

  // Always keep primary state pinned in multi-state list
  const ensurePrimary = (states: string[]) =>
    business.state && !states.includes(business.state) ? [business.state, ...states] : states;

  const setLevel = (level: CoverageLevel) => {
    setC((prev) => ({
      ...prev,
      level,
      states: level === "multi_state" ? ensurePrimary(prev.states) : prev.states,
    }));
  };

  const toggleState = (code: string) => {
    if (code === business.state) return; // pinned
    setC((prev) => {
      const has = prev.states.includes(code);
      const next = has ? prev.states.filter((s) => s !== code) : [...prev.states, code];
      return { ...prev, states: ensurePrimary(next) };
    });
  };

  const estimate = useMemo(() => {
    const clusters =
      business.industry === "Legal" ? 12 :
      business.industry === "Medical" || business.industry === "Dental" ? 10 :
      business.industry === "Merchant Services" ? 10 : 8;

    const citiesPerState = (() => {
      if (c.city_size === "major") return 22;
      if (c.city_size === "medium_and_major") return 75;
      return 350;
    })();

    let totalCities = citiesPerState;
    if (c.level === "multi_state") {
      totalCities = citiesPerState * Math.max(c.states.length, 1);
    } else if (c.level === "national") {
      totalCities = c.city_size === "major" ? 300 : c.city_size === "medium_and_major" ? 1500 : 5000;
    }

    const total = servicesCount * clusters * totalCities;
    return { services: servicesCount, clusters, cities: totalCities, total };
  }, [business.industry, c, servicesCount]);

  const fmt = (n: number) => n.toLocaleString();

  const levelOptions: { id: CoverageLevel; title: string; subtitle: string }[] = [
    { id: "regional", title: "Regional", subtitle: "Top cities in your state — best for businesses serving one metro area" },
    { id: "statewide", title: "Statewide", subtitle: "All cities in your state — best for businesses serving an entire state" },
    { id: "multi_state", title: "Multi-State", subtitle: "Select specific states — best for businesses operating across state lines" },
    { id: "national", title: "National", subtitle: "All 50 states — best for nationwide service businesses" },
  ];

  const sizeOptions: { id: CitySize; title: string; subtitle: string }[] = [
    { id: "major", title: "Major Cities Only", subtitle: "Population 100K+ — fewer pages, highest-value targets" },
    { id: "medium_and_major", title: "Medium and Major Cities", subtitle: "Population 25K+ — balanced coverage" },
    { id: "all_cities", title: "All Cities Including Small Towns", subtitle: "Every city in coverage area — maximum coverage" },
  ];

  return (
    <div>
      <h1 style={h1Style}>Where do you want to be found?</h1>
      <p style={{ ...pStyle, marginBottom: 32 }}>Choose your geographic reach. You can expand later.</p>

      <h2 style={h2Style}>Coverage level *</h2>
      <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
        {levelOptions.map((opt) => (
          <RadioCard key={opt.id} active={c.level === opt.id} onClick={() => setLevel(opt.id)}
            testId={`card-level-${opt.id}`} title={opt.title} subtitle={opt.subtitle} />
        ))}
      </div>

      {c.level === "multi_state" && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={h2Style}>
            Select states <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 14 }}>
              ({c.states.length} selected)
            </span>
          </h2>
          <p style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12 }}>
            Your primary state ({business.state}) is locked in.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 8 }}>
            {US_STATES.map((s) => {
              const selected = c.states.includes(s.code);
              const pinned = s.code === business.state;
              return (
                <button key={s.code} type="button" onClick={() => toggleState(s.code)}
                  data-testid={`chip-state-${s.code}`}
                  disabled={pinned}
                  style={{
                    padding: "10px 0", borderRadius: 6,
                    background: selected ? COLORS.accent : COLORS.card,
                    color: selected ? "#fff" : COLORS.text,
                    border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
                    fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY,
                    cursor: pinned ? "default" : "pointer",
                    opacity: pinned ? 0.85 : 1,
                  }}>
                  {s.code}{pinned && " 📌"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <h2 style={h2Style}>City size preference *</h2>
      <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
        {sizeOptions.map((opt) => (
          <RadioCard key={opt.id} active={c.city_size === opt.id} onClick={() => setC((p) => ({ ...p, city_size: opt.id }))}
            testId={`card-size-${opt.id}`} title={opt.title} subtitle={opt.subtitle} />
        ))}
      </div>

      <div style={{
        background: "rgba(59,130,246,0.08)", border: `1px solid rgba(59,130,246,0.3)`,
        borderRadius: 12, padding: 20, marginBottom: 32,
      }} data-testid="estimate-box">
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Estimated pages
        </div>
        <div style={{ fontSize: 14, color: COLORS.text, marginBottom: 8 }}>
          {fmt(estimate.services)} services × {fmt(estimate.clusters)} clusters × {fmt(estimate.cities)} cities
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: COLORS.accent, fontFamily: FONT_HEAD, letterSpacing: "-0.02em" }} data-testid="text-estimate-total">
          ~{fmt(estimate.total)} pages
        </div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>
          Rough estimate. Exact counts confirmed during account setup.
        </div>
      </div>

      <div className="nx-nav-buttons" style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={onBack} testId="button-step3-back">← Back</Btn>
        <Btn primary onClick={() => onNext(c)} testId="button-step3-next">Next →</Btn>
      </div>
    </div>
  );
}

const h2Style: React.CSSProperties = {
  fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 800,
  color: COLORS.text, marginBottom: 14, marginTop: 0,
};

function RadioCard({ active, onClick, title, subtitle, testId }: {
  active: boolean; onClick: () => void; title: string; subtitle: string; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      style={{
        textAlign: "left", padding: "16px 18px", borderRadius: 10,
        background: active ? "rgba(59,130,246,0.08)" : COLORS.card,
        border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
        cursor: "pointer", color: COLORS.text, fontFamily: FONT_BODY,
        display: "flex", alignItems: "center", gap: 14,
      }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
        border: `2px solid ${active ? COLORS.accent : COLORS.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.accent }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.45 }}>{subtitle}</div>
      </div>
    </button>
  );
}

// ─── STEP 4 ──────────────────────────────────────────────────────────────────
function Step4({ token: _token, planType, business, services, coverage, servicesCount, onEdit, onSubmit, submitting, submitError }: {
  token: string;
  planType: string;
  business: BusinessData;
  services: string[];
  coverage: CoverageData;
  servicesCount: number;
  onEdit: (step: 1 | 2 | 3) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const [confirmed, setConfirmed] = useState(false);

  const stateName = US_STATES.find((s) => s.code === business.state)?.name || business.state;
  const levelLabel = (() => {
    if (coverage.level === "regional") return `Regional — ${stateName}`;
    if (coverage.level === "statewide") return `Statewide — ${stateName}`;
    if (coverage.level === "national") return "National — all 50 states";
    return `Multi-State — ${coverage.states.join(", ")}`;
  })();
  const sizeLabel = coverage.city_size === "major" ? "Major Cities Only (100K+)"
    : coverage.city_size === "medium_and_major" ? "Medium and Major Cities (25K+)"
    : "All Cities Including Small Towns";

  const clusters =
    business.industry === "Legal" ? 12 :
    business.industry === "Medical" || business.industry === "Dental" ? 10 :
    business.industry === "Merchant Services" ? 10 : 8;
  const citiesPerState = coverage.city_size === "major" ? 22 : coverage.city_size === "medium_and_major" ? 75 : 350;
  let totalCities = citiesPerState;
  if (coverage.level === "multi_state") totalCities = citiesPerState * Math.max(coverage.states.length, 1);
  else if (coverage.level === "national") totalCities = coverage.city_size === "major" ? 300 : coverage.city_size === "medium_and_major" ? 1500 : 5000;
  const totalPages = servicesCount * clusters * totalCities;

  return (
    <div>
      <h1 style={h1Style}>Review and submit</h1>
      <p style={{ ...pStyle, marginBottom: 32 }}>Last check before we start building your account.</p>

      <Section title="Business Info" onEdit={() => onEdit(1)}>
        <Row k="Business name" v={business.legal_name} />
        {business.brand_name && <Row k="Brand name" v={business.brand_name} />}
        <Row k="Domain" v={business.domain} />
        <Row k="Phone" v={business.phone} />
        <Row k="Email" v={business.email} />
        <Row k="Location" v={`${business.city}, ${business.state}`} />
        <Row k="Industry" v={business.industry} />
        {business.tagline && <Row k="Tagline" v={business.tagline} />}
        <Row k="Brand color" v={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: business.brand_color, border: `1px solid ${COLORS.border}`, display: "inline-block" }} />
            <span>{business.brand_color}</span>
          </span>
        } />
      </Section>

      <Section title={`Services (${services.length} selected)`} onEdit={() => onEdit(2)}>
        <div style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.7 }} data-testid="text-review-services">
          {services.join(", ")}
        </div>
      </Section>

      <Section title="Coverage" onEdit={() => onEdit(3)}>
        <Row k="Level" v={levelLabel} />
        <Row k="City size" v={sizeLabel} />
        <Row k="Estimated pages" v={`~${totalPages.toLocaleString()}`} />
      </Section>

      <Section title="Plan">
        <Row k="Type" v={PLAN_LABEL[planType] || planType} />
      </Section>

      <label style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: 16, background: COLORS.card, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, marginBottom: 20, cursor: "pointer",
      }}>
        <input type="checkbox" checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          data-testid="checkbox-confirm"
          style={{ width: 20, height: 20, accentColor: COLORS.accent, marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.5 }}>
          I confirm this information is accurate and understand that pages will be generated based on these inputs.
        </span>
      </label>

      {submitError && <div style={{ ...errorStyle, marginBottom: 16, fontSize: 14 }} data-testid="error-submit">{submitError}</div>}

      <Btn primary full disabled={!confirmed || submitting} onClick={onSubmit} testId="button-submit">
        {submitting ? "Submitting…" : "Start My Nexus Account"}
      </Btn>
    </div>
  );
}

function Section({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div style={{
      background: COLORS.card, border: `1px solid ${COLORS.border}`,
      borderRadius: 12, padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{
          margin: 0, fontFamily: FONT_HEAD, fontSize: 12, fontWeight: 800,
          letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.muted,
        }}>{title}</h3>
        {onEdit && (
          <button type="button" onClick={onEdit}
            data-testid={`button-edit-${title.toLowerCase().replace(/\W+/g, "-")}`}
            style={{
              background: "none", border: "none", color: COLORS.accent,
              fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0,
            }}>Edit</button>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "6px 0", fontSize: 14 }}>
      <div style={{ width: 130, flexShrink: 0, color: COLORS.muted }}>{k}</div>
      <div style={{ color: COLORS.text, wordBreak: "break-word", flex: 1 }}>{v}</div>
    </div>
  );
}

// ─── STEP 5 — Confirmation ───────────────────────────────────────────────────
function Step5Confirm({ email }: { email: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{
        width: 72, height: 72, borderRadius: "50%",
        background: "rgba(16,185,129,0.1)", border: `2px solid rgba(16,185,129,0.4)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 28px", fontSize: 32, color: COLORS.success,
      }}>✓</div>
      <h1 style={h1Style} data-testid="text-confirm-headline">You're all set</h1>
      <p style={{ ...pStyle, maxWidth: 480, margin: "0 auto 32px" }}>
        Your onboarding is submitted and your Nexus account is being built.
        We will notify you at <strong style={{ color: COLORS.text }}>{email}</strong> when your first pages are ready.
      </p>
      <div style={{
        textAlign: "left", maxWidth: 380, margin: "0 auto 32px",
        background: COLORS.card, border: `1px solid ${COLORS.border}`,
        borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
          Estimated timeline
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 14, color: COLORS.text, lineHeight: 1.9 }}>
          <li>• Account setup: within 1 hour</li>
          <li>• Page generation: within 24 hours</li>
          <li>• First pages live: within 48 hours</li>
        </ul>
      </div>
      <p style={{ fontSize: 14, color: COLORS.muted }}>
        Questions? Call <a href={`tel:${PHONE_TEL}`} style={linkStyle}>{PHONE_DISPLAY}</a>
      </p>
    </div>
  );
}
