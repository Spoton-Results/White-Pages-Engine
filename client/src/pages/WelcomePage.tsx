const BOOKING_URL = (import.meta as any).env?.VITE_BOOKING_URL || "#pricing";

export default function WelcomePage() {
  return (
    <div style={{
      minHeight: "100vh", background: "#09090b", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "40px 24px",
      fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "rgba(16,185,129,0.1)", border: "2px solid rgba(16,185,129,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 36px", fontSize: 30, color: "#10b981",
        }}>✓</div>
        <h1 style={{
          fontFamily: "'Satoshi', 'Syne', sans-serif",
          fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 900,
          color: "#fafafa", marginBottom: 20, letterSpacing: "-0.03em",
          lineHeight: 1.1,
        }}>
          Welcome to Nexus
        </h1>
        <p style={{
          fontSize: 17, color: "#a1a1aa", lineHeight: 1.75,
          marginBottom: 40, maxWidth: 460, margin: "0 auto 40px",
        }}>
          Your subscription is active. We will reach out within 24 hours to begin
          your onboarding and set up your first client sites.
        </p>
        <a
          href={BOOKING_URL}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "16px 36px", background: "#3b82f6", color: "#fff",
            borderRadius: 8, textDecoration: "none", fontSize: 15, fontWeight: 600,
            fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
            transition: "background 0.2s, box-shadow 0.2s",
            boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
          }}
          data-testid="link-welcome-book"
        >
          Book Your Onboarding Call
        </a>
        <div style={{ marginTop: 32 }}>
          <a href="/" style={{ fontSize: 13, color: "#52525b", textDecoration: "none" }}>
            ← Back to spotonnexus.com
          </a>
        </div>
      </div>
    </div>
  );
}
