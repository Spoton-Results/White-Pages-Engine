import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  if (!total) return "0%";
  return Math.round((n / total) * 100) + "%";
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const BUCKET_ORDER = ["90-100", "80-89", "70-79", "60-69", "50-59", "40-49", "0-39", "unscored"];

function bucketColor(bucket: string) {
  if (bucket === "90-100") return "#16a34a";
  if (bucket === "80-89") return "#22c55e";
  if (bucket === "70-79") return "#84cc16";
  if (bucket === "60-69") return "#eab308";
  if (bucket === "50-59") return "#f97316";
  if (bucket === "40-49") return "#ef4444";
  if (bucket === "0-39") return "#dc2626";
  return "#9ca3af";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TierCard({ label, count, total, color, badge, detail }: {
  label: string; count: number; total: number;
  color: string; badge: string; detail: string;
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function SearchControlPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [websiteId, setWebsiteId] = useState<string>("");
  const [tier1Threshold, setTier1Threshold] = useState(80);
  const [applyTier3, setApplyTier3] = useState(false);
  const [tier3Threshold, setTier3Threshold] = useState(50);
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

  const scorePagesMutation = useMutation({
    mutationFn: () => apiRequest(`/api/websites/${websiteId}/score-pages`, { method: "POST" }),
    onSuccess: () => {
      setScoringRunning(true);
      toast({ title: "Scoring started", description: "Pages are being scored in the background. Stats will refresh automatically." });
      setTimeout(() => {
        setScoringRunning(false);
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "tier-stats"] });
      }, 30000);
    },
  });

  const recomputeBanksMutation = useMutation({
    mutationFn: () => apiRequest(`/api/websites/${websiteId}/bank-completeness/recompute`, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({ title: "Recomputed", description: `Updated completeness for ${data.computed} services.` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "bank-completeness"] });
    },
  });

  const applyTiersMutation = useMutation({
    mutationFn: () => apiRequest(`/api/websites/${websiteId}/apply-tiers`, {
      method: "POST",
      body: JSON.stringify({ tier1Threshold, applyTier3, tier3Threshold }),
    }),
    onSuccess: (data: any) => {
      toast({
        title: "Tiers updated",
        description: `Promoted ${data.promoted} pages to Tier 1${data.demoted ? `, demoted ${data.demoted} to Tier 3` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "tier-stats"] });
    },
  });

  const promoteFallbackMutation = useMutation({
    mutationFn: (slug: string) => apiRequest(`/api/websites/${websiteId}/fallback-hits/promote`, {
      method: "POST",
      body: JSON.stringify({ slug }),
    }),
    onSuccess: () => {
      toast({ title: "Marked as promoted", description: "Slug flagged for baking into inventory." });
      refetchFallback();
    },
  });

  const sortedBuckets = BUCKET_ORDER
    .map(b => tierStats?.scoreDistribution?.find(d => d.bucket === b))
    .filter(Boolean) as Array<{ bucket: string; count: number }>;

  const maxBucketCount = Math.max(...(sortedBuckets.map(b => b.count)), 1);
  const total = tierStats?.total || 0;

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111827", margin: 0 }}>SEO Search Control</h1>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: ".9rem" }}>
              Control which pages Google indexes. Tier 1 = Priority, Tier 2 = Live, Tier 3 = Hidden.
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
            {statsLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>Loading stats…</div>
            ) : tierStats && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
                  <TierCard label="pages in Google's priority queue" count={tierStats.tier1} total={total}
                    color="#16a34a" badge="Tier 1 — Google Priority"
                    detail="In primary sitemap · index,follow" />
                  <TierCard label="live pages, lower crawl priority" count={tierStats.tier2} total={total}
                    color="#2563eb" badge="Tier 2 — Live Not Promoted"
                    detail="In secondary sitemap · index,follow" />
                  <TierCard label="hidden from Google" count={tierStats.tier3} total={total}
                    color="#dc2626" badge="Tier 3 — Hidden / noindex"
                    detail="Excluded from sitemaps · noindex,nofollow" />
                  <TierCard label="not yet scored" count={tierStats.unscored} total={total}
                    color="#9ca3af" badge="Unscored"
                    detail="Click 'Score All Pages' to evaluate" />
                </div>

                {tierStats.avgScore !== null && (
                  <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>AVG QUALITY SCORE</span>
                      <span style={{ fontSize: "1.4rem", fontWeight: 800, color: tierStats.avgScore >= 80 ? "#16a34a" : tierStats.avgScore >= 50 ? "#2563eb" : "#dc2626" }}>
                        {tierStats.avgScore}/100
                      </span>
                    </div>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: ".8rem", color: "#6b7280", fontWeight: 600 }}>TOTAL PUBLISHED</span>
                      <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "#111827" }}>{total.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {/* Score Distribution Chart */}
                {sortedBuckets.length > 0 && (
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 24 }}>
                    <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Quality Score Distribution</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {sortedBuckets.map(b => (
                        <div key={b.bucket} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 80, fontSize: ".8rem", color: "#6b7280", textAlign: "right", flexShrink: 0 }}>{b.bucket}</div>
                          <div style={{ flex: 1, height: 18, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", width: `${Math.round((b.count / maxBucketCount) * 100)}%`,
                              background: bucketColor(b.bucket), borderRadius: 4,
                              transition: "width .4s ease",
                            }} />
                          </div>
                          <div style={{ width: 60, fontSize: ".8rem", color: "#374151", fontWeight: 600 }}>
                            {b.count.toLocaleString()} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({pct(b.count, total)})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Action Panel */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 24 }}>
              <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Actions</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>

                <div>
                  <button
                    data-testid="button-score-pages"
                    onClick={() => scorePagesMutation.mutate()}
                    disabled={scorePagesMutation.isPending || scoringRunning}
                    style={{
                      background: "#2563eb", color: "#fff", border: "none", borderRadius: 8,
                      padding: "9px 18px", fontWeight: 600, fontSize: ".9rem", cursor: "pointer",
                      opacity: (scorePagesMutation.isPending || scoringRunning) ? 0.7 : 1,
                    }}
                  >
                    {scoringRunning ? "Scoring in progress…" : "Score All Unscored Pages"}
                  </button>
                  <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 4 }}>Evaluates content quality and assigns recommended tiers</div>
                </div>

                <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
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
                      Also hide (Tier 3) if score &lt;
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
                  <button
                    data-testid="button-apply-tiers"
                    onClick={() => applyTiersMutation.mutate()}
                    disabled={applyTiersMutation.isPending}
                    style={{
                      background: applyTier3 ? "#dc2626" : "#16a34a", color: "#fff", border: "none", borderRadius: 8,
                      padding: "9px 18px", fontWeight: 600, fontSize: ".9rem", cursor: "pointer",
                      opacity: applyTiersMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    {applyTiersMutation.isPending ? "Applying…" : "Apply Tier Assignments"}
                  </button>
                  <div style={{ fontSize: ".75rem", color: "#9ca3af", marginTop: 4 }}>
                    {applyTier3
                      ? "Will promote high-score pages to Tier 1 AND hide low-score pages from Google"
                      : "Only promotes high-score pages to Tier 1 (safe — no pages hidden)"}
                  </div>
                </div>
              </div>
            </div>

            {/* Fallback Hits */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Dynamic Fallback Hits</h2>
                  <p style={{ margin: "4px 0 0", fontSize: ".8rem", color: "#6b7280" }}>
                    Pages served on-the-fly (not in your inventory). These are always noindexed. Promote frequently-hit slugs to bake them in.
                  </p>
                </div>
              </div>
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
                          <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: ".8rem", color: "#374151", maxWidth: 340, wordBreak: "break-all" }}>
                            {hit.slug}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: hit.hitCount >= 10 ? "#dc2626" : "#374151" }}>
                            {hit.hitCount.toLocaleString()}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fmtDate(hit.firstSeenAt)}</td>
                          <td style={{ padding: "8px 12px", color: "#6b7280" }}>{fmtDate(hit.lastSeenAt)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            {hit.promoted ? (
                              <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>
                                Promoted
                              </span>
                            ) : (
                              <span style={{ background: "#fef3c7", color: "#d97706", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>
                                noindex
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            {!hit.promoted && (
                              <button
                                data-testid={`button-promote-${hit.id}`}
                                onClick={() => promoteFallbackMutation.mutate(hit.slug)}
                                disabled={promoteFallbackMutation.isPending}
                                style={{
                                  background: "#2563eb", color: "#fff", border: "none", borderRadius: 6,
                                  padding: "5px 12px", fontSize: ".78rem", fontWeight: 600, cursor: "pointer",
                                }}
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
            </div>

            {/* Bank Completeness */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Variation Bank Completeness</h2>
                  <p style={{ margin: "4px 0 0", fontSize: ".8rem", color: "#6b7280" }}>
                    Services with full banks (all 5 sections, 5+ variations each) can reach Tier 1.
                  </p>
                </div>
                <button
                  data-testid="button-recompute-banks"
                  onClick={() => recomputeBanksMutation.mutate()}
                  disabled={recomputeBanksMutation.isPending}
                  style={{
                    background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8,
                    padding: "7px 14px", fontSize: ".8rem", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {recomputeBanksMutation.isPending ? "Computing…" : "Recompute"}
                </button>
              </div>
              {bankCompleteness.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "#9ca3af", fontSize: ".9rem" }}>
                  No completeness data yet. Run a bulk generation job to populate this.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Service</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Sections</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Avg Vars</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Score</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Tier 1 Ready</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankCompleteness.map((b: BankCompleteness) => {
                        const sectionFlags = [b.hasIntro, b.hasHowItWorks, b.hasBenefits, b.hasFaq, b.hasCta];
                        const sectionLabels = ["Intro", "How It Works", "Benefits", "FAQ", "CTA"];
                        const sectionCount = sectionFlags.filter(Boolean).length;
                        return (
                          <tr key={b.id} data-testid={`row-bank-${b.id}`} style={{ borderBottom: "1px solid #f9fafb" }}>
                            <td style={{ padding: "8px 12px", color: "#111827", fontWeight: 500 }}>{b.service}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                                {sectionLabels.map((label, i) => (
                                  <span
                                    key={label}
                                    title={label}
                                    style={{
                                      width: 24, height: 24, borderRadius: 4, fontSize: ".65rem", fontWeight: 700,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: sectionFlags[i] ? "#dcfce7" : "#fee2e2",
                                      color: sectionFlags[i] ? "#16a34a" : "#dc2626",
                                    }}
                                  >
                                    {label[0]}
                                  </span>
                                ))}
                              </div>
                              <div style={{ fontSize: ".7rem", color: "#9ca3af", marginTop: 2 }}>{sectionCount}/5</div>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right", color: b.avgVariationsPerSection >= 5 ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                              {b.avgVariationsPerSection}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                <div style={{ width: 60, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{
                                    height: "100%", width: `${b.completenessScore}%`,
                                    background: b.completenessScore >= 80 ? "#16a34a" : b.completenessScore >= 50 ? "#eab308" : "#dc2626",
                                    borderRadius: 3,
                                  }} />
                                </div>
                                <span style={{ fontWeight: 700, color: "#374151", fontSize: ".85rem" }}>{b.completenessScore}</span>
                              </div>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              {b.isEligibleForTier1 ? (
                                <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 700 }}>✓ Ready</span>
                              ) : (
                                <span style={{ background: "#f3f4f6", color: "#9ca3af", borderRadius: 12, padding: "2px 10px", fontSize: ".75rem", fontWeight: 600 }}>Incomplete</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </>
        )}
      </div>
    </DashboardLayout>
  );
}
