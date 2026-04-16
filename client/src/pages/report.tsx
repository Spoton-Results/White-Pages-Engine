import { useEffect, useState } from "react";
import { useParams } from "wouter";

interface ReportData {
  businessName: string;
  domain: string;
  generatedAt: string;
  stats: {
    totalPages: number;
    tier1Pages: number;
    tier2Pages: number;
    servicesCovered: number;
  };
  bankHealth: {
    totalServices: number;
    fullyWritten: number;
    needsAttention: number;
  };
  topPages: Array<{
    title: string;
    url: string;
    qualityScore: number | null;
    tier: number;
  }>;
  sitemapStatus: {
    exists: boolean;
    lastGenerated: string | null;
  };
}

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function ClientReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/report/${token}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Report not found");
        }
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message || "Failed to load report"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="size-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center space-y-3 max-w-sm">
          <div className="text-4xl font-bold text-gray-300">404</div>
          <p className="text-gray-600 font-medium">Report not found</p>
          <p className="text-sm text-gray-400">
            {error || "This link may be invalid or the report may have been reset."}
          </p>
        </div>
      </div>
    );
  }

  const { businessName, domain, generatedAt, stats, bankHealth, topPages, sitemapStatus } = data;
  const bankReady = bankHealth.totalServices > 0 && bankHealth.needsAttention === 0;

  const tierBadge = (tier: number) => {
    if (tier === 1) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">T1</span>;
    if (tier === 2) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">T2</span>;
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">T3</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="report-business-name">
                {businessName}
              </h1>
              <p className="text-sm text-gray-500 mt-1 font-mono" data-testid="report-domain">
                {domain}
              </p>
            </div>
            <div className="text-right shrink-0 ml-4">
              <div className="text-xs text-gray-400">SEO Report</div>
              <div className="text-xs text-gray-300 mt-0.5">Powered by Nexus</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Stats row */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Pages Published
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Pages Published", value: fmt(stats.totalPages), highlight: false },
              { label: "Tier 1 — Google Priority", value: fmt(stats.tier1Pages), highlight: true },
              { label: "Tier 2 — Live", value: fmt(stats.tier2Pages), highlight: false },
              { label: "Services Covered", value: fmt(stats.servicesCovered), highlight: false },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border p-4 space-y-1">
                <div className={`text-2xl font-bold ${s.highlight ? "text-emerald-600" : "text-gray-900"}`}
                  data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {s.value}
                </div>
                <div className="text-xs text-gray-500 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bank Health */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4" data-testid="report-bank-health-header">
            Content Bank Health
          </h2>
          {bankHealth.totalServices === 0 ? (
            <p className="text-sm text-gray-400">No content banks configured yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.round((bankHealth.fullyWritten / bankHealth.totalServices) * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-700 shrink-0">
                  {bankHealth.fullyWritten} of {bankHealth.totalServices} services
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`size-2 rounded-full ${bankReady ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className={`text-sm font-medium ${bankReady ? "text-emerald-700" : "text-amber-700"}`}
                  data-testid="report-bank-status">
                  {bankReady ? "Ready to Scale" : "Needs Attention"}
                </span>
                {!bankReady && (
                  <span className="text-sm text-gray-400">
                    — {bankHealth.needsAttention} service{bankHealth.needsAttention !== 1 ? "s" : ""} incomplete
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Top 10 Pages */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-sm font-semibold text-gray-900">Top 10 Pages by Quality Score</h2>
          </div>
          {topPages.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400">
              No scored pages yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Page Title</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">URL</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topPages.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900 max-w-xs truncate" data-testid={`page-title-${i}`}>
                        {p.title}
                      </td>
                      <td className="px-6 py-3 hidden sm:table-cell">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs font-mono truncate block max-w-xs"
                          data-testid={`page-url-${i}`}
                        >
                          {p.url.replace("https://", "")}
                        </a>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className={`font-semibold text-sm ${(p.qualityScore ?? 0) >= 80 ? "text-emerald-600" : (p.qualityScore ?? 0) >= 60 ? "text-amber-600" : "text-gray-600"}`}
                          data-testid={`page-score-${i}`}>
                          {p.qualityScore ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center" data-testid={`page-tier-${i}`}>
                        {tierBadge(p.tier)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sitemap Status */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Sitemap Status</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Sitemap submitted</span>
              <span className={`font-medium ${sitemapStatus.exists ? "text-emerald-600" : "text-gray-400"}`}
                data-testid="report-sitemap-exists">
                {sitemapStatus.exists ? "Yes" : "Not yet"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Last regenerated</span>
              <span className="font-medium text-gray-700" data-testid="report-sitemap-date">
                {fmtDate(sitemapStatus.lastGenerated)}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="max-w-4xl mx-auto px-6 pb-12">
        <div className="flex items-center justify-between text-xs text-gray-400 border-t pt-6">
          <span data-testid="report-footer">
            Report generated {fmtDate(generatedAt)}. Updated automatically.
          </span>
          <span className="text-gray-300">Powered by Nexus</span>
        </div>
      </div>
    </div>
  );
}
