import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Website { id: string; name: string; domain: string; }

interface TierStats {
  tier1: number; tier2: number; tier3: number; unscored: number; total: number;
  avgScore: number | null;
  scoreDistribution: Array<{ bucket: string; count: number }>;
}

interface FallbackHit {
  id: string; slug: string; hitCount: number;
  firstSeenAt: string; lastSeenAt: string;
  promoted: boolean; promotedAt: string | null;
}

interface BankCompleteness {
  id: string; service: string;
  hasIntro: boolean; hasHowItWorks: boolean; hasBenefits: boolean; hasFaq: boolean; hasCta: boolean;
  totalVariations: number; avgVariationsPerSection: number;
  completenessScore: number; isEligibleForTier1: boolean;
  lastComputedAt: string;
}

interface TopService { name: string; count: number; }
interface TopState  { stateCode: string; count: number; }
interface ThinBank  { service: string; completenessScore: number; isEligibleForTier1: boolean; avgVariationsPerSection: number; }
interface RecentScore { id: string; title: string; slug: string; qualityScore: number | null; tier: number; updatedAt: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  if (!total) return "0%";
  return Math.round((n / total) * 100) + "%";
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function scoreColor(s: number) {
  if (s >= 80) return "#16a34a";
  if (s >= 65) return "#22c55e";
  if (s >= 55) return "#eab308";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}

const BUCKET_ORDER = ["90-100", "80-89", "70-79", "60-69", "50-59", "40-49", "0-39", "unscored"];
function bucketColor(b: string) {
  if (b === "90-100") return "#16a34a";
  if (b === "80-89") return "#22c55e";
  if (b === "70-79") return "#84cc16";
  if (b === "60-69") return "#eab308";
  if (b === "50-59") return "#f97316";
  if (b === "40-49") return "#ef4444";
  if (b === "0-39")  return "#dc2626";
  return "#9ca3af";
}

// ── TierCard ──────────────────────────────────────────────────────────────────

function TierCard({ label, count, total, color, badge, detail }: {
  label: string; count: number; total: number; color: string; badge: string; detail: string;
}) {
  return (
    <div style={{ background: "#fff", border: `2px solid ${color}20`, borderRadius: 12, padding: "1.25rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: ".75rem", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{badge}</div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{count.toLocaleString()}</div>
          <div style={{ fontSize: ".85rem", color: "#6b7280", marginTop: 4 }}>{label}</div>
        </div>
        <div style={{ background: `${color}15`, color, fontWeight: 700, fontSize: ".9rem", padding: "4px 12px", borderRadius: 20 }}>
          {pct(count, total)}
        </div>
      </div>
      <div style={{ marginTop: 10, height: 4, background: "#f3f4f6", borderRadius: 2 }}>
        <div style={{ height: 4, background: color, borderRadius: 2, width: pct(count, total) }} />
      </div>
      <div style={{ marginTop: 6, fontSize: ".75rem", color: "#9ca3af" }}>{detail}</div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: subtitle || action ? "1rem" : ".75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>{title}</h2>
          {subtitle && <p style={{ margin: "4px 0 0", fontSize: ".8rem", color: "#6b7280" }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Bar chart row ─────────────────────────────────────────────────────────────

function BarRow({ label, count, max, color = "#2563eb" }: { label: string; count: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <div style={{ width: 140, fontSize: ".8rem", color: "#374151", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flexShrink: 0 }} title={label}>{label}</div>
      <div style={{ flex: 1, height: 14, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 4, transition: "width .4s" }} />
      </div>
      <div style={{ width: 50, fontSize: ".8rem", color: "#374151", fontWeight: 600, textAlign: "right" }}>{count.toLocaleString()}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SearchControlPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [websiteId, setWebsiteId] = useState<string>("");
  const [tier1Threshold, setTier1Threshold] = useState(80);
  const [applyTier3, setApplyTier3] = useState(false);
  const [tier3Threshold, setTier3Threshold] = useState(55);
  const [scoringRunning, setScoringRunning] = useState(false);

  const { data: websites = [] } = useQuery<Website[]>({
    queryKey: ["/api/websites"],
    queryFn: () => apiRequest("/api/websites"),
  });

  const { data: tierStats, isLoading: statsLoading } = useQuery<TierStats>({
    queryKey: ["/api/websites", websiteId, "tier-stats"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/tier-stats`),
    enabled: !!websiteId,
    refetchInterval: scoringRunning ? 5000 : false,
  });

  const { data: fallbackHits = [], refetch: refetchFallback } = useQuery<FallbackHit[]>({
    queryKey: ["/api/websites", websiteId, "fallback-hits"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/fallback-hits?limit=50`),
    enabled: !!websiteId,
  });

  const { data: bankCompleteness = [] } = useQuery<BankCompleteness[]>({
    queryKey: ["/api/websites", websiteId, "bank-completeness"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/bank-completeness`),
    enabled: !!websiteId,
  });

  // P8 — top breakdowns + thin bank warnings
  const { data: topServices = [] } = useQuery<TopService[]>({
    queryKey: ["/api/websites", websiteId, "top-services"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/top-services`),
    enabled: !!websiteId,
  });

  const { data: topStates = [] } = useQuery<TopState[]>({
    queryKey: ["/api/websites", websiteId, "top-states"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/top-states`),
    enabled: !!websiteId,
  });

  const { data: thinBanks = [] } = useQuery<ThinBank[]>({
    queryKey: ["/api/websites", websiteId, "thin-bank-warnings"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/thin-bank-warnings`),
    enabled: !!websiteId,
  });

  // P9 — recently scored
  const { data: recentlyScored = [] } = useQuery<RecentScore[]>({
    queryKey: ["/api/websites", websiteId, "recently-scored"],
    queryFn: () => apiRequest(`/api/websites/${websiteId}/recently-scored?limit=30`),
    enabled: !!websiteId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const scorePagesMutation = useMutation({
    mutationFn: () => api.post(`/api/websites/${websiteId}/score-pages`, {}),
    onSuccess: () => {
      setScoringRunning(true);
      toast({ title: "Scoring started", description: "Pages scored in background. Stats refresh every 5s." });
      setTimeout(() => {
        setScoringRunning(false);
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "tier-stats"] });
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "recently-scored"] });
      }, 35000);
    },
  });

  // P6 — combined score + promote
  const scoreAndPromoteMutation = useMutation({
    mutationFn: () => api.post(`/api/websites/${websiteId}/score-and-promote`, { tier1Threshold, tier3Threshold, applyTier3 }),
    onSuccess: () => {
      setScoringRunning(true);
      toast({ title: "Score & Promote started", description: "Job running in background — stats will refresh in ~30s." });
      setTimeout(() => {
        setScoringRunning(false);
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "tier-stats"] });
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "top-services"] });
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "top-states"] });
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "recently-scored"] });
      }, 35000);
    },
  });

  const recomputeBanksMutation = useMutation({
    mutationFn: () => api.post(`/api/websites/${websiteId}/bank-completeness/recompute`, {}),
    onSuccess: (data: any) => {
      toast({ title: "Recomputed", description: `Updated ${data.computed} services.` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "thin-bank-warnings"] });
    },
  });

  const applyTiersMutation = useMutation({
    mutationFn: () => api.post(`/api/websites/${websiteId}/apply-tiers`, { tier1Threshold, applyTier3, tier3Threshold }),
    onSuccess: (data: any) => {
      toast({
        title: "Tiers updated",
        description: `Promoted ${data.promoted} pages${data.demoted ? `, demoted ${data.demoted}` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "tier-stats"] });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "top-services"] });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "top-states"] });
    },
  });

  const promoteFallbackMutation = useMutation({
    mutationFn: (slug: string) => api.post(`/api/websites/${websiteId}/fallback-hits/promote`, { slug }),
    onSuccess: () => {
      toast({ title: "Marked as promoted" });
      refetchFallback();
    },
  });

  const sortedBuckets = BUCKET_ORDER
    .map(b => tierStats?.scoreDistribution?.find(d => d.bucket === b))
    .filter(Boolean) as Array<{ bucket: string; count: number }>;
  const maxBucketCount = Math.max(...sortedBuckets.map(b => b.count), 1);
  const total = tierStats?.total || 0;
  const maxServiceCount = Math.max(...topServices.map(s => s.count), 1);
  const maxStateCount  = Math.max(...topStates.map(s => s.count), 1);

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111827", margin: 0 }}>SEO Control</h1>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: ".9rem" }}>
              Tier 1 = Google Priority · Tier 2 = Live · Tier 3 = Hidden (noindex)
            </p>
          </div>
          <select
            data-testid="select-website"
            value={websiteId}
            onChange={e => setWebsiteId(e.target.value)}
            style={{ padding: "8px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: ".9rem", background: "#fff" }}
          >
            <option value="">— Select website —</option>
            {websites.map((w: Website) => (
              <option key={w.id} value={w.id}>{w.name} ({w.domain})</option>
            ))}
          </select>
        </div>

        {!websiteId && (
          <div style={{ textAlign: "center", padding: "4rem 0", color: "#9ca3af", fontSize: "1rem" }}>
            Select a website to view its SEO control dashboard.
          </div>
        )}

        {websiteId && (
          <>
            {/* Tier Stats Cards */}
            {statsLoading
              ? <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>Loading stats…</div>
              : tierStats && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
                    <TierCard label="in Google's priority queue" count={tierStats.tier1} total={total} color="#16a34a" badge="Tier 1 — Priority" detail="Primary sitemap · index,follow" />
                    <TierCard label="live, lower crawl priority" count={tierStats.tier2} total={total} color="#2563eb" badge="Tier 2 — Live" detail="Secondary sitemap · index,follow" />
                    <TierCard label="hidden from Google" count={tierStats.tier3} total={total} color="#dc2626" badge="Tier 3 — noindex" detail="Excluded from sitemaps" />
                    <TierCard label="not yet scored" count={tierStats.unscored} total={total} color="#9ca3af" badge="Unscored" detail="Click Score All to evaluate" />
                  </div>

                  {tierStats.avgScore !== null && (
                    <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>AVG QUALITY SCORE</span>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: scoreColor(tierStats.avgScore) }}>
                          {tierStats.avgScore}/100
                        </span>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>TOTAL PUBLISHED</span>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "#111827" }}>{total.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  {/* Score Distribution */}
                  {sortedBuckets.length > 0 && (
                    <Section title="Quality Score Distribution">
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {sortedBuckets.map(b => (
                          <div key={b.bucket} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 80, fontSize: ".8rem", color: "#6b7280", textAlign: "right", flexShrink: 0 }}>{b.bucket}</div>
                            <div style={{ flex: 1, height: 18, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.round((b.count / maxBucketCount) * 100)}%`, background: bucketColor(b.bucket), borderRadius: 4, transition: "width .4s" }} />
                            </div>
                            <div style={{ width: 80, fontSize: ".8rem", color: "#374151", fontWeight: 600 }}>
                              {b.count.toLocaleString()} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({pct(b.count, total)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </>
              )}

            {/* P8 — Top Services / States by Tier 1 */}
            {(topServices.length > 0 || topStates.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                {topServices.length > 0 && (
                  <Section title="Top Services by Tier 1" subtitle="Services driving the most T1 pages">
                    {topServices.map(s => (
                      <BarRow key={s.name} label={s.name} count={s.count} max={maxServiceCount} color="#16a34a" />
                    ))}
                  </Section>
                )}
                {topStates.length > 0 && (
                  <Section title="Top States by Tier 1" subtitle="States with the most T1 page coverage">
                    {topStates.map(s => (
                      <BarRow key={s.stateCode} label={s.stateCode?.toUpperCase() || "—"} count={s.count} max={maxStateCount} color="#2563eb" />
                    ))}
                  </Section>
                )}
              </div>
            )}

            {/* P8 — Thin-Bank Warnings */}
            {thinBanks.length > 0 && (
              <Section
                title="⚠ Thin Bank Warnings"
                subtitle="Services with completeness < 60% — these hurt Tier 1 eligibility"
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                  {thinBanks.map(b => (
                    <div key={b.service} style={{ background: "#fef9f0", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px" }}>
                      <div style={{ fontWeight: 600, fontSize: ".85rem", color: "#92400e", marginBottom: 4 }}>{b.service}</div>
                      <div style={{ display: "flex", gap: 8, fontSize: ".75rem", color: "#78350f" }}>
                        <span>Score: <strong>{b.completenessScore}%</strong></span>
                        <span>Avg vars: <strong>{b.avgVariationsPerSection}</strong></span>
                      </div>
                      <div style={{ marginTop: 6, height: 4, background: "#fed7aa", borderRadius: 2 }}>
                        <div style={{ height: 4, background: "#f97316", borderRadius: 2, width: `${b.completenessScore}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* P6 — Score & Promote (Combined Action) */}
            <Section title="Scoring & Tier Control" subtitle="Score unscored pages and apply tier assignments in one or two steps.">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>

                {/* Thresholds */}
                <div style={{ background: "#f9fafb", borderRadius: 8, padding: "12px 16px", border: "1px solid #e5e7eb", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontSize: ".8rem", color: "#374151", fontWeight: 600 }}>Tier 1 if score ≥</label>
                  <input
                    data-testid="input-tier1-threshold"
                    type="number" min={50} max={100} value={tier1Threshold}
                    onChange={e => setTier1Threshold(Number(e.target.value))}
                    style={{ width: 60, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: ".9rem" }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "#374151", fontWeight: 600, cursor: "pointer" }}>
                    <input
                      data-testid="checkbox-apply-tier3"
                      type="checkbox" checked={applyTier3}
                      onChange={e => setApplyTier3(e.target.checked)}
                    />
                    Also hide (T3) if score &lt;
                  </label>
                  {applyTier3 && (
                    <input
                      data-testid="input-tier3-threshold"
                      type="number" min={0} max={79} value={tier3Threshold}
                      onChange={e => setTier3Threshold(Number(e.target.value))}
                      style={{ width: 60, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: ".9rem" }}
                    />
                  )}
                </div>

                {/* Combined button (P6) */}
                <div>
                  <button
                    data-testid="button-score-and-promote"
                    onClick={() => scoreAndPromoteMutation.mutate()}
                    disabled={scoreAndPromoteMutation.isPending || scoringRunning}
                    style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: ".9rem", cursor: "pointer", opacity: (scoreAndPromoteMutation.isPending || scoringRunning) ? .7 : 1 }}
                  >
                    {scoringRunning ? "Working…" : "⚡ Score & Promote All"}
                  </button>
                  <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 4 }}>Scores unscored pages then applies tier rules in one shot</div>
                </div>

                {/* Separate buttons */}
                <div>
                  <button
                    data-testid="button-score-pages"
                    onClick={() => scorePagesMutation.mutate()}
                    disabled={scorePagesMutation.isPending || scoringRunning}
                    style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 600, fontSize: ".9rem", cursor: "pointer", opacity: (scorePagesMutation.isPending || scoringRunning) ? .7 : 1 }}
                  >
                    Score Unscored Only
                  </button>
                  <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 4 }}>Evaluates unscored pages — does not change tiers</div>
                </div>

                <div>
                  <button
                    data-testid="button-apply-tiers"
                    onClick={() => applyTiersMutation.mutate()}
                    disabled={applyTiersMutation.isPending}
                    style={{ background: applyTier3 ? "#dc2626" : "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 600, fontSize: ".9rem", cursor: "pointer", opacity: applyTiersMutation.isPending ? .7 : 1 }}
                  >
                    {applyTiersMutation.isPending ? "Applying…" : "Apply Tiers Only"}
                  </button>
                  <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 4 }}>
                    {applyTier3 ? "Promotes high-score + hides low-score pages" : "Promotes high-score pages to Tier 1 only"}
                  </div>
                </div>
              </div>
            </Section>

            {/* P9 — Recently Scored */}
            {recentlyScored.length > 0 && (
              <Section title="Recently Scored Pages" subtitle="Last 30 pages with quality scores — most recently updated first">
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                        <th style={{ textAlign: "left", padding: "6px 10px", color: "#6b7280", fontWeight: 600 }}>Page</th>
                        <th style={{ textAlign: "center", padding: "6px 10px", color: "#6b7280", fontWeight: 600, width: 80 }}>Score</th>
                        <th style={{ textAlign: "center", padding: "6px 10px", color: "#6b7280", fontWeight: 600, width: 60 }}>Tier</th>
                        <th style={{ textAlign: "left", padding: "6px 10px", color: "#6b7280", fontWeight: 600, width: 110 }}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentlyScored.map((p: RecentScore) => (
                        <tr key={p.id} data-testid={`row-scored-${p.id}`} style={{ borderBottom: "1px solid #f9fafb" }}>
                          <td style={{ padding: "6px 10px", color: "#374151", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <span style={{ fontWeight: 800, color: p.qualityScore !== null ? scoreColor(p.qualityScore) : "#9ca3af" }}>
                              {p.qualityScore ?? "—"}
                            </span>
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <span style={{
                              background: p.tier === 1 ? "#dcfce7" : p.tier === 2 ? "#dbeafe" : "#fee2e2",
                              color: p.tier === 1 ? "#16a34a" : p.tier === 2 ? "#1d4ed8" : "#dc2626",
                              borderRadius: 12, padding: "1px 8px", fontSize: ".72rem", fontWeight: 700,
                            }}>T{p.tier}</span>
                          </td>
                          <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{fmtDate(p.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Fallback Hits */}
            <Section
              title="Dynamic Fallback Hits"
              subtitle="Pages served on-the-fly (not in inventory). Always noindexed. Promote frequently-hit slugs to bake them in."
            >
              {fallbackHits.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "#9ca3af", fontSize: ".9rem" }}>No fallback hits recorded yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Slug</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Hits</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>First Seen</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Last Seen</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Status</th>
                        <th style={{ padding: "8px 12px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {fallbackHits.map((hit: FallbackHit) => (
                        <tr key={hit.id} data-testid={`row-fallback-${hit.id}`} style={{ borderBottom: "1px solid #f9fafb" }}>
                          <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: ".8rem", color: "#374151", maxWidth: 340, wordBreak: "break-all" }}>{hit.slug}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: hit.hitCount >= 10 ? "#dc2626" : "#374151" }}>{hit.hitCount.toLocaleString()}</td>
                          <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fmtDate(hit.firstSeenAt)}</td>
                          <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fmtDate(hit.lastSeenAt)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            {hit.promoted
                              ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>Promoted</span>
                              : <span style={{ background: "#fef3c7", color: "#d97706", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>noindex</span>}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {!hit.promoted && (
                              <button
                                data-testid={`button-promote-${hit.id}`}
                                onClick={() => promoteFallbackMutation.mutate(hit.slug)}
                                disabled={promoteFallbackMutation.isPending}
                                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: ".78rem", fontWeight: 600, cursor: "pointer" }}
                              >
                                Mark Promoted
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Bank Completeness */}
            <Section
              title="Variation Bank Completeness"
              subtitle="Legacy content-bank health signal. Tier 1 is now based on quality score, coverage, and active approved content inventory."
              action={
                <button
                  data-testid="button-recompute-banks"
                  onClick={() => recomputeBanksMutation.mutate()}
                  disabled={recomputeBanksMutation.isPending}
                  style={{ background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 14px", fontSize: ".8rem", fontWeight: 600, cursor: "pointer" }}
                >
                  {recomputeBanksMutation.isPending ? "Computing…" : "Recompute"}
                </button>
              }
            >
              {bankCompleteness.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "#9ca3af", fontSize: ".9rem" }}>No completeness data yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Service</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Core Sections</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Avg Vars</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Score</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>T1 Ready</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankCompleteness.map((b: BankCompleteness) => {
                        const flags = [b.hasIntro, b.hasHowItWorks, b.hasBenefits, b.hasFaq, b.hasCta];
                        const labels = ["I", "H", "B", "F", "C"];
                        return (
                          <tr key={b.id} data-testid={`row-bank-${b.id}`} style={{ borderBottom: "1px solid #f9fafb" }}>
                            <td style={{ padding: "8px 12px", color: "#111827", fontWeight: 500 }}>{b.service}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                                {labels.map((label, i) => (
                                  <span key={label} title={["Intro","How It Works","Benefits","FAQ","CTA"][i]}
                                    style={{ width: 22, height: 22, borderRadius: 4, fontSize: ".65rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: flags[i] ? "#dcfce7" : "#fee2e2", color: flags[i] ? "#16a34a" : "#dc2626" }}>
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right", color: b.avgVariationsPerSection >= 5 ? "#16a34a" : "#d97706", fontWeight: 600 }}>{b.avgVariationsPerSection}</td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                <div style={{ width: 60, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${b.completenessScore}%`, background: b.completenessScore >= 80 ? "#16a34a" : b.completenessScore >= 50 ? "#eab308" : "#dc2626", borderRadius: 3 }} />
                                </div>
                                <span style={{ fontWeight: 700, color: "#374151" }}>{b.completenessScore}</span>
                              </div>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              {b.isEligibleForTier1
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>✓ Ready</span>
                                : <span style={{ background: "#f3f4f6", color: "#9ca3af", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 600 }}>Incomplete</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

          </>
        )}
      </div>
    </DashboardLayout>
  );
}
