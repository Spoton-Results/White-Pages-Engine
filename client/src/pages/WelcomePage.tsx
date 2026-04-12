export default function WelcomePage() {
  return (
    <div style={{
      minHeight: "100vh", background: "#09090b", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px",
    }}>
      <div style={{ textAlign: "center", maxWidth: 540 }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "rgba(16,185,129,0.12)", border: "2px solid rgba(16,185,129,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 32px", fontSize: 28,
        }}>✓</div>
        <h1 style={{
          fontFamily: "Satoshi, Syne, sans-serif", fontSize: "clamp(28px,5vw,40px)",
          fontWeight: 800, color: "#fafafa", marginBottom: 16, letterSpacing: "-0.03em",
        }}>You're in.</h1>
        <p style={{
          fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif", fontSize: 17,
          color: "#a1a1aa", lineHeight: 1.7, marginBottom: 36,
        }}>
          Thank you for signing up for Nexus. We'll be in touch shortly to kick off your onboarding
          and set up your first client sites.
        </p>
        <a
          href="/"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "14px 32px", background: "#3b82f6", color: "#fff",
            border: "none", borderRadius: 8, cursor: "pointer", textDecoration: "none",
            fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
            fontSize: 15, fontWeight: 600,
          }}
        >
          Back to Home
        </a>
      </div>
    </div>
  );
}
