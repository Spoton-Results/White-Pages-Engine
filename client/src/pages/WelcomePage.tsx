import { useEffect, useState } from "react";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string }
  | { kind: "waiting"; attempts: number }
  | { kind: "failed" };

const PHONE_DISPLAY = "(844) 723-1900";
const PHONE_TEL = "+18447231900";

export default function WelcomePage() {
  const [state, setState] = useState<LookupState>({ kind: "idle" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;
    const INTERVAL_MS = 3000;

    const lookup = async () => {
      try {
        const res = await fetch(
          `/api/stripe/onboarding-redirect?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            setState({ kind: "ready", token: data.token });
            return;
          }
        }
        if (res.status === 404) {
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS) {
            setState({ kind: "failed" });
            return;
          }
          setState({ kind: "waiting", attempts });
          setTimeout(lookup, INTERVAL_MS);
          return;
        }
        // Unexpected status — treat as waiting / will eventually fail
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          setState({ kind: "failed" });
        } else {
          setState({ kind: "waiting", attempts });
          setTimeout(lookup, INTERVAL_MS);
        }
      } catch {
        if (cancelled) return;
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          setState({ kind: "failed" });
        } else {
          setState({ kind: "waiting", attempts });
          setTimeout(lookup, INTERVAL_MS);
        }
      }
    };

    setState({ kind: "loading" });
    lookup();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#09090b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(16,185,129,0.1)",
            border: "2px solid rgba(16,185,129,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 36px",
            fontSize: 30,
            color: "#10b981",
          }}
        >
          ✓
        </div>
        <h1
          style={{
            fontFamily: "'Satoshi', 'Syne', sans-serif",
            fontSize: "clamp(28px, 5vw, 44px)",
            fontWeight: 900,
            color: "#fafafa",
            marginBottom: 20,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
          data-testid="text-welcome-headline"
        >
          Welcome to Nexus
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "#a1a1aa",
            lineHeight: 1.75,
            marginBottom: 40,
            maxWidth: 460,
            margin: "0 auto 40px",
          }}
          data-testid="text-welcome-body"
        >
          Your payment is confirmed and your account is being prepared. Complete the
          onboarding form to tell us about your business, services, and coverage area.
          Your first pages will begin generating automatically.
        </p>

        {(state.kind === "loading" || state.kind === "waiting") && (
          <div data-testid="status-welcome-waiting" style={{ marginBottom: 24 }}>
            <div
              style={{
                width: 36,
                height: 36,
                border: "3px solid rgba(255,255,255,0.1)",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                margin: "0 auto 16px",
                animation: "nx-spin 0.9s linear infinite",
              }}
            />
            <p style={{ color: "#a1a1aa", fontSize: 14, margin: 0 }}>
              Setting up your account... please wait.
            </p>
            <style>{`@keyframes nx-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {state.kind === "ready" && (
          <a
            href={`/onboard/${state.token}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 36px",
              background: "#3b82f6",
              color: "#fff",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              transition: "background 0.2s, box-shadow 0.2s",
              boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
            }}
            data-testid="link-welcome-onboard"
          >
            Complete Your Onboarding Form
          </a>
        )}

        {state.kind === "idle" && (
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 36px",
              background: "#3b82f6",
              color: "#fff",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
              opacity: 0.85,
            }}
            data-testid="link-welcome-coming-soon"
          >
            Onboarding form coming soon
          </a>
        )}

        {state.kind === "failed" && (
          <p
            style={{ color: "#a1a1aa", fontSize: 15, lineHeight: 1.6 }}
            data-testid="text-welcome-fallback"
          >
            Your payment was received. If you are not redirected shortly, please call{" "}
            <a
              href={`tel:${PHONE_TEL}`}
              style={{ color: "#3b82f6", textDecoration: "none" }}
            >
              {PHONE_DISPLAY}
            </a>
            .
          </p>
        )}

        <p
          style={{
            marginTop: 32,
            fontSize: 13,
            color: "#52525b",
          }}
          data-testid="text-welcome-contact"
        >
          Questions? Call{" "}
          <a
            href={`tel:${PHONE_TEL}`}
            style={{ color: "#71717a", textDecoration: "none" }}
          >
            {PHONE_DISPLAY}
          </a>
        </p>

        <div style={{ marginTop: 16 }}>
          <a
            href="/"
            style={{ fontSize: 13, color: "#52525b", textDecoration: "none" }}
          >
            ← Back to spotonnexus.com
          </a>
        </div>
      </div>
    </div>
  );
}
