import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Website { id: string; name: string; domain: string; }

interface BankHealth {
  id: string;
  service: string;
  // Core
  hasIntro: boolean;
  hasHowItWorks: boolean;
  hasBenefits: boolean;
  hasFaq: boolean;
  hasCta: boolean;
  // Extended
  hasLocalContext: boolean;
  hasUseCase: boolean;
  hasProofTrust: boolean;
  hasPainPoint: boolean;
  hasLocalStat: boolean;
  // Metrics
  totalVariations: number;
  avgVariationsPerSection: number;
  completenessScore: number;
  isEligibleForTier1: boolean;
  lastComputedAt: string;
}

// ── Section definitions ───────────────────────────────────────────────────────

const CORE_SECTIONS: Array<{ key: keyof BankHealth; label: string }> = [
  { key: "hasIntro",      label: "Intro" },
  { key: "hasHowItWorks", label: "How It Works" },
  { key: "hasBenefits",   label: "Benefits" },
  { key: "hasFaq",        label: "FAQ" },
  { key: "hasCta",        label: "CTA" },
];

const EXTENDED_SECTIONS: Array<{ key: keyof BankHealth; label: string }> = [
  { key: "hasLocalContext", label: "Local Context" },
  { key: "hasUseCase",     label: "Use Case" },
  { key: "hasProofTrust",  label: "Proof & Trust" },
  { key: "hasPainPoint",   label: "Pain Point" },
  { key: "hasLocalStat",   label: "Local Stat" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return "#16a34a";
  if (score >= 65) return "#22c55e";
  if (score >= 50) return "#eab308";
  if (score >= 35) return "#f97316";
  return "#ef4444";
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getMissingCore(bank: BankHealth): string[] {
  return CORE_SECTIONS.filter(s => !bank[s.key]).map(s => s.label);
}

function getMissingExt(bank: BankHealth): string[] {
  return EXTENDED_SECTIONS.filter(s => !bank[s.key]).map(s => s.label);
}

// ── ServiceCard ───────────────────────────────────────────────────────────────

function ServiceCard({
  bank,
  websiteId,
  onAction,
}: {
  bank: BankHealth;
  websiteId: string;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const fillMissing = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/variation-banks/fill-missing`, { service: bank.service }),
    onSuccess: (data: any) => {
      const filled = data?.filled ?? [];
      toast({
        title: filled.length > 0 ? `Filled ${filled.length} section(s)` : "Nothing to fill",
        description: filled.length > 0 ? filled.join(", ") : "All sections already present.",
      });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      onAction();
    },
    onError: (e: any) => toast({ title: "Fill failed", description: e.message, variant: "destructive" }),
  });

  const rewriteAll = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/variation-banks/write`, { service: bank.service }),
    onSuccess: () => {
      toast({ title: "Rewrite started", description: `All sections for "${bank.service}" are being rewritten.` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      onAction();
    },
    onError: (e: any) => toast({ title: "Rewrite failed", description: e.message, variant: "destructive" }),
  });

  const color = scoreColor(bank.completenessScore);
  const isBusy = fillMissing.isPending || rewriteAll.isPending;
  const missingCore = getMissingCore(bank);
  const missingExt = getMissingExt(bank);

  return (
    <div
      data-testid={`card-bank-${bank.service}`}
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>{bank.service}</div>
          <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 2 }}>
            Last computed: {fmtDate(bank.lastComputedAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {bank.isEligibleForTier1 ? (
            <span
              data-testid={`badge-eligible-${bank.service}`}
              style={{ background: "#dcfce7", color: "#16a34a", fontWeight: 700, fontSize: ".75rem", padding: "3px 10px", borderRadius: 20, border: "1px solid #bbf7d0" }}
            >
              Safe to Scale
            </span>
          ) : (
            <span
              data-testid={`badge-ineligible-${bank.service}`}
              style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontSize: ".75rem", padding: "3px 10px", borderRadius: 20, border: "1px solid #fde68a" }}
            >
              Needs Work
            </span>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>Completeness</span>
          <span style={{ fontSize: ".8rem", fontWeight: 800, color }}>{bank.completenessScore}%</span>
        </div>
        <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4 }}>
          <div style={{ height: 8, background: color, borderRadius: 4, width: `${bank.completenessScore}%`, transition: "width .3s" }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 20, fontSize: ".8rem", color: "#6b7280" }}>
        <span><strong style={{ color: "#374151" }}>{bank.totalVariations}</strong> total variations</span>
        <span><strong style={{ color: "#374151" }}>{bank.avgVariationsPerSection}</strong> avg / section</span>
      </div>

      {/* Section checklists */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Core (5)</div>
          {CORE_SECTIONS.map(s => (
            <div key={s.key as string} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: ".85rem", color: bank[s.key] ? "#16a34a" : "#d1d5db" }}>
                {bank[s.key] ? "✓" : "✗"}
              </span>
              <span style={{ fontSize: ".8rem", color: bank[s.key] ? "#374151" : "#9ca3af" }}>{s.label}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Extended (5)</div>
          {EXTENDED_SECTIONS.map(s => (
            <div key={s.key as string} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: ".85rem", color: bank[s.key] ? "#16a34a" : "#d1d5db" }}>
                {bank[s.key] ? "✓" : "✗"}
              </span>
              <span style={{ fontSize: ".8rem", color: bank[s.key] ? "#374151" : "#9ca3af" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Missing summary */}
      {(missingCore.length > 0 || missingExt.length > 0) && (
        <div style={{ background: "#fef9f0", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px", fontSize: ".78rem", color: "#92400e" }}>
          Missing: {[...missingCore, ...missingExt].join(", ")}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          data-testid={`btn-fill-missing-${bank.service}`}
          onClick={() => fillMissing.mutate()}
          disabled={isBusy || (missingCore.length === 0 && missingExt.length === 0)}
          style={{
            background: (missingCore.length > 0 || missingExt.length > 0) ? "#2563eb" : "#e5e7eb",
            color: (missingCore.length > 0 || missingExt.length > 0) ? "#fff" : "#9ca3af",
            border: "none", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem",
            fontWeight: 600, cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          {fillMissing.isPending ? "Filling…" : "Fill Missing"}
        </button>
        <button
          data-testid={`btn-rewrite-${bank.service}`}
          onClick={() => rewriteAll.mutate()}
          disabled={isBusy}
          style={{
            background: "#fff", color: "#374151", border: "1px solid #d1d5db",
            borderRadius: 6, padding: "6px 14px", fontSize: ".82rem",
            fontWeight: 600, cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          {rewriteAll.isPending ? "Rewriting…" : "Rewrite All"}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BankHealthPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState("");
  const [thinJobId, setThinJobId] = useState<string | null>(null);
  const [thinWriting, setThinWriting] = useState(false);
  const [fillAllProgress, setFillAllProgress] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });

  const websitesQ = useQuery<Website[]>({
    queryKey: ["/api/websites"],
    queryFn: () => fetch("/api/websites", { credentials: "include" }).then(r => r.json()),
  });

  const healthQ = useQuery<BankHealth[]>({
    queryKey: ["/api/websites", websiteId, "bank-completeness"],
    queryFn: () =>
      fetch(`/api/websites/${websiteId}/bank-completeness`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  const recompute = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/bank-completeness/recompute`, {}),
    onSuccess: (data: any) => {
      toast({ title: `Recomputed ${data?.computed ?? 0} service(s)` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
    },
    onError: (e: any) => toast({ title: "Recompute failed", description: e.message, variant: "destructive" }),
  });

  const thinJobQ = useQuery<any>({
    queryKey: ["/api/websites", websiteId, "bank-write-job"],
    queryFn: () => fetch(`/api/websites/${websiteId}/bank-write-job`, { credentials: "include" }).then(r => r.json()),
    enabled: !!thinJobId && !!websiteId,
    refetchInterval: (q: any) => {
      const status = q.state.data?.status;
      return status === "done" || status === "error" || !status ? false : 1500;
    },
  });

  useEffect(() => {
    const status = thinJobQ.data?.status;
    if ((status === "done" || status === "error") && thinJobId) {
      setThinJobId(null);
      setThinWriting(false);
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      toast({ title: "Thin bank write complete" });
    }
  }, [thinJobQ.data?.status, thinJobId]);

  const writeThinBanks = async () => {
    setThinWriting(true);
    try {
      const result = await apiRequest("POST", `/api/websites/${websiteId}/variation-banks/write-thin`, { threshold: 70 });
      if (result.started) {
        setThinJobId(result.jobId);
        toast({ title: `Writing ${result.total} thin bank(s)…` });
      } else {
        toast({ title: result.message || "No thin banks found" });
        setThinWriting(false);
      }
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
      setThinWriting(false);
    }
  };

  const fillAllMissing = async () => {
    const banksWithMissing = banks.filter(b =>
      getMissingCore(b).length > 0 || getMissingExt(b).length > 0
    );
    if (banksWithMissing.length === 0) {
      toast({ title: "Nothing to fill", description: "All sections are already present." });
      return;
    }
    setFillAllProgress({ running: true, done: 0, total: banksWithMissing.length });
    let totalFilled = 0;
    for (let i = 0; i < banksWithMissing.length; i++) {
      const b = banksWithMissing[i];
      try {
        const result: any = await apiRequest("POST", `/api/websites/${websiteId}/variation-banks/fill-missing`, { service: b.service });
        totalFilled += result?.filled?.length ?? 0;
      } catch (_) { /* continue on error */ }
      setFillAllProgress({ running: true, done: i + 1, total: banksWithMissing.length });
    }
    setFillAllProgress({ running: false, done: 0, total: 0 });
    qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
    toast({ title: `Fill complete`, description: `Filled ${totalFilled} section(s) across ${banksWithMissing.length} service(s).` });
  };

  const websites = websitesQ.data ?? [];
  const banks = healthQ.data ?? [];
  const eligible = banks.filter(b => b.isEligibleForTier1).length;
  const avgScore = banks.length > 0
    ? Math.round(banks.reduce((s, b) => s + b.completenessScore, 0) / banks.length)
    : 0;

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111827", margin: 0 }}>Bank Health</h1>
            <p style={{ color: "#6b7280", marginTop: 4, fontSize: ".9rem" }}>
              Variation bank completeness — manage content quality before scaling to Google.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              data-testid="select-website"
              value={websiteId}
              onChange={e => setWebsiteId(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: ".9rem", minWidth: 220, cursor: "pointer" }}
            >
              <option value="">— Select website —</option>
              {websites.map(w => (
                <option key={w.id} value={w.id}>{w.name} ({w.domain})</option>
              ))}
            </select>
            {websiteId && (
              <>
                <button
                  data-testid="btn-write-thin-banks"
                  onClick={writeThinBanks}
                  disabled={thinWriting || !!thinJobId}
                  style={{
                    background: thinWriting || thinJobId ? "#e5e7eb" : "#2563eb", color: thinWriting || thinJobId ? "#9ca3af" : "#fff",
                    border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: thinWriting || thinJobId ? "not-allowed" : "pointer",
                  }}
                >
                  {thinWriting ? "Starting…" : thinJobId ? `Writing ${thinJobQ.data?.done ?? 0}/${thinJobQ.data?.total ?? "?"} banks…` : "Bulk Write Thin Banks"}
                </button>
                <button
                  data-testid="btn-fill-missing-all"
                  onClick={fillAllMissing}
                  disabled={fillAllProgress.running || thinWriting || !!thinJobId}
                  style={{
                    background: fillAllProgress.running ? "#e5e7eb" : "#059669",
                    color: fillAllProgress.running ? "#9ca3af" : "#fff",
                    border: "none", borderRadius: 8, padding: "8px 18px",
                    fontSize: ".9rem", fontWeight: 600,
                    cursor: fillAllProgress.running ? "not-allowed" : "pointer",
                  }}
                >
                  {fillAllProgress.running
                    ? `Filling ${fillAllProgress.done}/${fillAllProgress.total}…`
                    : "Fill Missing All"}
                </button>
                <button
                  data-testid="btn-recompute-all"
                  onClick={() => recompute.mutate()}
                  disabled={recompute.isPending}
                  style={{
                    background: "#111827", color: "#fff", border: "none", borderRadius: 8,
                    padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {recompute.isPending ? "Recomputing…" : "Recompute All"}
                </button>
              </>
            )}
          </div>
        </div>

        {!websiteId && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
            Select a website to view bank health.
          </div>
        )}

        {websiteId && healthQ.isLoading && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Loading…</div>
        )}

        {websiteId && !healthQ.isLoading && banks.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
            No bank completeness data yet. Run the bulk generator or click Recompute All.
          </div>
        )}

        {websiteId && banks.length > 0 && (
          <>
            {/* Summary strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
              {[
                { label: "Total Services", value: banks.length.toString(), color: "#2563eb" },
                { label: "Safe to Scale", value: eligible.toString(), color: "#16a34a" },
                { label: "Needs Work", value: (banks.length - eligible).toString(), color: "#f97316" },
                { label: "Avg Completeness", value: `${avgScore}%`, color: avgScore >= 65 ? "#16a34a" : "#f97316" },
              ].map(stat => (
                <div
                  key={stat.label}
                  style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem 1.25rem" }}
                >
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div style={{ fontSize: ".8rem", color: "#6b7280", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span><strong>Core (5):</strong> Intro · How It Works · Benefits · FAQ · CTA — required for Tier 1 eligibility</span>
              <span><strong>Extended (5):</strong> Local Context · Use Case · Proof & Trust · Pain Point · Local Stat — boost completeness score</span>
            </div>

            {/* Service cards grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
              {banks.map(bank => (
                <ServiceCard
                  key={bank.id}
                  bank={bank}
                  websiteId={websiteId}
                  onAction={() => qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] })}
                />
              ))}
            </div>
          </>
        )}

      </div>
    </DashboardLayout>
  );
}
