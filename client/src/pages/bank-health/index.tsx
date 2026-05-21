import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

interface Website { id: string; name: string; domain: string; }

interface BankHealth {
  id: string;
  service: string;
  hasIntro: boolean;
  hasHowItWorks: boolean;
  hasBenefits: boolean;
  hasFaq: boolean;
  hasCta: boolean;
  hasLocalContext: boolean;
  hasUseCase: boolean;
  hasProofTrust: boolean;
  hasPainPoint: boolean;
  hasLocalStat: boolean;
  hasComparison: boolean;
  hasPricingFactors: boolean;
  hasBestFit: boolean;
  hasSoftwareIntegration: boolean;
  totalVariations: number;
  avgVariationsPerSection: number;
  completenessScore: number;
  isEligibleForTier1: boolean;
  lastComputedAt: string;
}

const CORE_SECTIONS: Array<{ key: keyof BankHealth; label: string }> = [
  { key: "hasIntro", label: "Intro" },
  { key: "hasHowItWorks", label: "How It Works" },
  { key: "hasBenefits", label: "Benefits" },
  { key: "hasFaq", label: "FAQ" },
  { key: "hasCta", label: "CTA" },
];

const EXTENDED_SECTIONS: Array<{ key: keyof BankHealth; label: string }> = [
  { key: "hasLocalContext", label: "Local Context" },
  { key: "hasUseCase", label: "Use Case" },
  { key: "hasProofTrust", label: "Proof & Trust" },
  { key: "hasPainPoint", label: "Pain Point" },
  { key: "hasLocalStat", label: "Local Stat" },
];

const SEO_EXPANSION_SECTIONS: Array<{ key: keyof BankHealth; label: string }> = [
  { key: "hasComparison", label: "Comparison" },
  { key: "hasPricingFactors", label: "Pricing Factors" },
  { key: "hasBestFit", label: "Best Fit" },
  { key: "hasSoftwareIntegration", label: "Software Integration" },
];

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

function missing(bank: BankHealth, sections: Array<{ key: keyof BankHealth; label: string }>) {
  return sections.filter(s => !bank[s.key]).map(s => s.label);
}

function SectionChecklist({ title, sections, bank }: { title: string; sections: Array<{ key: keyof BankHealth; label: string }>; bank: BankHealth }) {
  return (
    <div>
      <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>{title}</div>
      {sections.map(s => (
        <div key={s.key as string} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: ".85rem", color: bank[s.key] ? "#16a34a" : "#d1d5db" }}>{bank[s.key] ? "✓" : "✗"}</span>
          <span style={{ fontSize: ".8rem", color: bank[s.key] ? "#374151" : "#9ca3af" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function ServiceCard({
  bank,
  websiteId,
  activeFillJobId,
  onFillStarted,
  onAction,
}: {
  bank: BankHealth;
  websiteId: string;
  activeFillJobId: string | null;
  onFillStarted: (jobId: string) => void;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const fillMissing = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/variation-banks/fill-missing`, { service: bank.service }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data?.started && data?.jobId) {
        onFillStarted(data.jobId);
        toast({
          title: `Filling missing sections for "${bank.service}"…`,
          description: "Running in background — the card will update when done.",
        });
      } else if (data?.ok === true) {
        const filled: string[] = data?.filled ?? [];
        if (filled.length > 0) {
          toast({ title: `Filled ${filled.length} section(s) for "${bank.service}"` });
          qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
        } else {
          toast({ title: `All sections already present for "${bank.service}"`, description: "Nothing was missing." });
        }
      } else if (data?.error) {
        toast({ title: data.error, variant: "destructive" });
      } else {
        console.warn("[fill-missing] Unexpected response shape:", data);
        toast({ title: "Fill request sent", description: "Response format changed — refresh to see updates." });
      }
      onAction();
    },
    onError: (e: any) => toast({ title: "Fill failed", description: e.message, variant: "destructive" }),
  });

  const rewriteAll = useMutation({
    mutationFn: () => apiRequest("POST", `/api/websites/${websiteId}/variation-banks/write`, { service: bank.service }),
    onSuccess: () => {
      toast({ title: "Rewrite started", description: `All 14 sections for "${bank.service}" are being rewritten.` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      onAction();
    },
    onError: (e: any) => toast({ title: "Rewrite failed", description: e.message, variant: "destructive" }),
  });

  const color = scoreColor(bank.completenessScore);
  const isFilling = fillMissing.isPending || !!activeFillJobId;
  const isBusy = isFilling || rewriteAll.isPending;
  const missingAll = [...missing(bank, CORE_SECTIONS), ...missing(bank, EXTENDED_SECTIONS), ...missing(bank, SEO_EXPANSION_SECTIONS)];

  return (
    <div data-testid={`card-bank-${bank.service}`} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>{bank.service}</div>
          <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 2 }}>Last computed: {fmtDate(bank.lastComputedAt)}</div>
        </div>
        {bank.isEligibleForTier1 ? (
          <span data-testid={`badge-eligible-${bank.service}`} style={{ background: "#dcfce7", color: "#16a34a", fontWeight: 700, fontSize: ".75rem", padding: "3px 10px", borderRadius: 20, border: "1px solid #bbf7d0" }}>Safe to Scale</span>
        ) : (
          <span data-testid={`badge-ineligible-${bank.service}`} style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontSize: ".75rem", padding: "3px 10px", borderRadius: 20, border: "1px solid #fde68a" }}>Needs Work</span>
        )}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>Completeness</span>
          <span style={{ fontSize: ".8rem", fontWeight: 800, color }}>{bank.completenessScore}%</span>
        </div>
        <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4 }}><div style={{ height: 8, background: color, borderRadius: 4, width: `${bank.completenessScore}%`, transition: "width .3s" }} /></div>
      </div>

      <div style={{ display: "flex", gap: 20, fontSize: ".8rem", color: "#6b7280", flexWrap: "wrap" }}>
        <span><strong style={{ color: "#374151" }}>{bank.totalVariations}</strong> total variations</span>
        <span><strong style={{ color: "#374151" }}>{bank.avgVariationsPerSection}</strong> avg / section</span>
        <span><strong style={{ color: "#374151" }}>14</strong> tracked sections</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <SectionChecklist title="Core (5)" sections={CORE_SECTIONS} bank={bank} />
        <SectionChecklist title="Extended (5)" sections={EXTENDED_SECTIONS} bank={bank} />
        <SectionChecklist title="SEO Expansion (4)" sections={SEO_EXPANSION_SECTIONS} bank={bank} />
      </div>

      {missingAll.length > 0 && (
        <div style={{ background: "#fef9f0", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px", fontSize: ".78rem", color: "#92400e" }}>
          {isFilling && activeFillJobId
            ? "⏳ Generating missing sections in background…"
            : `Missing: ${missingAll.join(", ")}`}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          data-testid={`btn-fill-missing-${bank.service}`}
          onClick={() => fillMissing.mutate()}
          disabled={isBusy || missingAll.length === 0}
          style={{ background: (missingAll.length > 0 && !isBusy) ? "#2563eb" : "#e5e7eb", color: (missingAll.length > 0 && !isBusy) ? "#fff" : "#9ca3af", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", fontWeight: 600, cursor: isBusy ? "not-allowed" : "pointer" }}
        >
          {fillMissing.isPending ? "Starting…" : activeFillJobId ? "Filling…" : "Fill Missing"}
        </button>
        <button
          data-testid={`btn-rewrite-${bank.service}`}
          onClick={() => rewriteAll.mutate()}
          disabled={isBusy}
          style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", fontWeight: 600, cursor: isBusy ? "not-allowed" : "pointer" }}
        >
          {rewriteAll.isPending ? "Rewriting…" : "Rewrite All"}
        </button>
      </div>
    </div>
  );
}

export default function BankHealthPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState(() => new URLSearchParams(window.location.search).get("websiteId") || "");
  const [thinJobId, setThinJobId] = useState<string | null>(null);
  const [thinWriting, setThinWriting] = useState(false);
  const [fillJobId, setFillJobId] = useState<string | null>(null);
  const [fillJobService, setFillJobService] = useState<string | null>(null);

  const websitesQ = useQuery<Website[]>({ queryKey: ["/api/websites"], queryFn: () => fetch("/api/websites", { credentials: "include" }).then(r => r.json()) });
  const healthQ = useQuery<BankHealth[]>({ queryKey: ["/api/websites", websiteId, "bank-completeness"], queryFn: () => fetch(`/api/websites/${websiteId}/bank-completeness`, { credentials: "include" }).then(r => r.json()), enabled: !!websiteId });

  const recompute = useMutation({
    mutationFn: () => apiRequest("POST", `/api/websites/${websiteId}/bank-completeness/recompute`, {}).then(r => r.json()),
    onSuccess: (data: any) => { toast({ title: `Recomputed ${data?.computed ?? 0} service(s)` }); qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] }); },
    onError: (e: any) => toast({ title: "Recompute failed", description: e.message, variant: "destructive" }),
  });

  const thinJobQ = useQuery<any>({ queryKey: ["/api/websites", websiteId, "bank-write-job"], queryFn: () => fetch(`/api/websites/${websiteId}/bank-write-job`, { credentials: "include" }).then(r => r.json()), enabled: !!thinJobId && !!websiteId, refetchInterval: (q: any) => { const status = q.state.data?.status; return status === "done" || status === "error" || !status ? false : 1500; } });

  const fillJobQ = useQuery<any>({
    queryKey: ["/api/jobs", fillJobId],
    queryFn: () => fetch(`/api/jobs/${fillJobId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!fillJobId,
    refetchInterval: (q: any) => {
      const status = q.state.data?.status;
      return status === "completed" || status === "failed" || !status ? false : 1500;
    },
  });

  const fillRestoreQ = useQuery<any>({ queryKey: ["/api/websites", websiteId, "fill-missing-job"], queryFn: () => fetch(`/api/websites/${websiteId}/fill-missing-job`, { credentials: "include" }).then(r => r.json()), enabled: !!websiteId && !fillJobId });
  const thinRestoreQ = useQuery<any>({ queryKey: ["/api/websites", websiteId, "bank-write-job"], queryFn: () => fetch(`/api/websites/${websiteId}/bank-write-job`, { credentials: "include" }).then(r => r.json()), enabled: !!websiteId && !thinJobId });

  useEffect(() => { if (fillRestoreQ.data?.jobId && !fillJobId) setFillJobId(fillRestoreQ.data.jobId); }, [fillRestoreQ.data?.jobId]);
  useEffect(() => { if (thinRestoreQ.data?.jobId && !thinJobId) setThinJobId(thinRestoreQ.data.jobId); }, [thinRestoreQ.data?.jobId]);
  useEffect(() => {
    const status = thinJobQ.data?.status;
    if ((status === "done" || status === "error") && thinJobId) {
      setThinJobId(null);
      setThinWriting(false);
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      toast({ title: "Thin bank write complete" });
    }
  }, [thinJobQ.data?.status, thinJobId]);

  useEffect(() => {
    const status = fillJobQ.data?.status;
    if ((status === "completed" || status === "failed") && fillJobId) {
      setFillJobId(null);
      setFillJobService(null);
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      toast({
        title: status === "completed" ? "Fill Missing complete" : "Fill Missing finished with errors",
        description: status === "completed" ? "Sections generated — cards updated." : "Some sections may not have filled. Check logs.",
      });
    }
  }, [fillJobQ.data?.status, fillJobId]);

  const websites = websitesQ.data ?? [];
  const banks = healthQ.data ?? [];
  const eligible = banks.filter(b => b.isEligibleForTier1).length;
  const avgScore = banks.length > 0 ? Math.round(banks.reduce((s, b) => s + b.completenessScore, 0) / banks.length) : 0;

  const writeThinBanks = async () => {
    setThinWriting(true);
    try {
      const result = await apiRequest("POST", `/api/websites/${websiteId}/variation-banks/write-thin`, { threshold: 70 }).then(r => r.json());
      if (result.started) { setThinJobId(result.jobId); toast({ title: `Writing ${result.total} thin bank(s)…` }); }
      else { toast({ title: result.message || "No thin banks found" }); setThinWriting(false); }
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); setThinWriting(false); }
  };

  const fillAllMissing = async () => {
    const banksWithMissing = banks.filter(b => [...missing(b, CORE_SECTIONS), ...missing(b, EXTENDED_SECTIONS), ...missing(b, SEO_EXPANSION_SECTIONS)].length > 0);
    if (banksWithMissing.length === 0) { toast({ title: "Nothing to fill", description: "All sections are already present." }); return; }
    try {
      const result = await apiRequest("POST", `/api/websites/${websiteId}/variation-banks/fill-missing-all-job`, { services: banksWithMissing.map(b => b.service) }).then(r => r.json());
      if (result.started) {
        setFillJobId(result.jobId);
        setFillJobService(null);
        toast({ title: `Filling missing sections for ${result.total} service(s)…`, description: "Running in background — you can navigate away." });
      } else {
        toast({ title: result.message || "Nothing to fill" });
      }
    } catch (e: any) { toast({ title: "Failed to start fill job", description: e.message, variant: "destructive" }); }
  };

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111827", margin: 0 }}>Bank Health</h1>
            <p style={{ color: "#6b7280", marginTop: 4, fontSize: ".9rem" }}>Variation bank completeness — manage content quality before scaling to Google.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select data-testid="select-website" value={websiteId} onChange={e => setWebsiteId(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: ".9rem", minWidth: 220, cursor: "pointer" }}>
              <option value="">— Select website —</option>
              {websites.map(w => <option key={w.id} value={w.id}>{w.name} ({w.domain})</option>)}
            </select>
            {websiteId && <>
              <button data-testid="btn-write-thin-banks" onClick={writeThinBanks} disabled={thinWriting || !!thinJobId} style={{ background: thinWriting || thinJobId ? "#e5e7eb" : "#2563eb", color: thinWriting || thinJobId ? "#9ca3af" : "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: thinWriting || thinJobId ? "not-allowed" : "pointer" }}>{thinWriting ? "Starting…" : thinJobId ? `Writing ${thinJobQ.data?.done ?? 0}/${thinJobQ.data?.total ?? "?"} banks…` : "Bulk Write Thin Banks"}</button>
              <button
                data-testid="btn-fill-missing-all"
                onClick={fillAllMissing}
                disabled={!!fillJobId || thinWriting || !!thinJobId}
                style={{ background: fillJobId ? "#e5e7eb" : "#059669", color: fillJobId ? "#9ca3af" : "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: fillJobId ? "not-allowed" : "pointer" }}
              >
                {fillJobId && !fillJobService
                  ? `Filling ${fillJobQ.data?.processedPages ?? 0}/${fillJobQ.data?.totalPages ?? "…"}…`
                  : fillJobId && fillJobService
                  ? "Filling…"
                  : "Fill Missing All"}
              </button>
              <button data-testid="btn-recompute-all" onClick={() => recompute.mutate()} disabled={recompute.isPending} style={{ background: "#111827", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: "pointer" }}>{recompute.isPending ? "Recomputing…" : "Recompute All"}</button>
            </>}
          </div>
        </div>

        {!websiteId && <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Select a website to view bank health.</div>}
        {websiteId && healthQ.isLoading && <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Loading…</div>}
        {websiteId && !healthQ.isLoading && banks.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>No bank completeness data yet. Run the bulk generator or click Recompute All.</div>}

        {websiteId && banks.length > 0 && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
            {[{ label: "Total Services", value: banks.length.toString(), color: "#2563eb" }, { label: "Safe to Scale", value: eligible.toString(), color: "#16a34a" }, { label: "Needs Work", value: (banks.length - eligible).toString(), color: "#f97316" }, { label: "Avg Completeness", value: `${avgScore}%`, color: avgScore >= 65 ? "#16a34a" : "#f97316" }].map(stat => <div key={stat.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem 1.25rem" }}><div style={{ fontSize: "1.6rem", fontWeight: 800, color: stat.color }}>{stat.value}</div><div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>{stat.label}</div></div>)}
          </div>

          <div style={{ fontSize: ".8rem", color: "#6b7280", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><strong>Core (5):</strong> Intro · How It Works · Benefits · FAQ · CTA — required for Tier 1 eligibility</span>
            <span><strong>Extended (5):</strong> Local Context · Use Case · Proof &amp; Trust · Pain Point · Local Stat — boost completeness</span>
            <span><strong>SEO Expansion (4):</strong> Comparison · Pricing Factors · Best Fit · Software Integration — topical depth</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {banks.map(bank => (
              <ServiceCard
                key={bank.id}
                bank={bank}
                websiteId={websiteId}
                activeFillJobId={fillJobService === bank.service ? fillJobId : null}
                onFillStarted={(jobId) => {
                  setFillJobId(jobId);
                  setFillJobService(bank.service);
                }}
                onAction={() => qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] })}
              />
            ))}
          </div>
        </>}
      </div>
    </DashboardLayout>
  );
}
