import { useEffect, useState } from "react";
import { useRoute } from "wouter";

interface DashboardData {
  brand_name: string;
  domain: string;
  status: string;
  readiness_score: number;
  page_stats: {
    total_pages: number;
    live_pages: number;
    draft_pages: number;
    tier1_live: number;
    tier2_live: number;
    new_this_week: number;
    promoted_this_week: number;
    avg_quality: number;
  } | null;
  recent_pages: Array<{ slug: string; title: string; tier: number | null; published_at: string | null; quality_score: number | null }>;
  launch_health: { score: number; breakdown: any } | null;
  warmup: { active: boolean; day: number; page_limit: number | null; next_increase_day: number | null; next_increase_limit: number | null; expires_at: string | null } | null;
  protection: { active: boolean; expires_in_days: number | null } | null;
  gap_report: any;
  wave_info: { waves_published: number } | null;
  booking_url: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Setting up",
  submitted: "Setting up",
  creating: "Building your account",
  ready_for_scoring: "Reviewing your information",
  ready_for_generation: "Preparing pages",
  needs_info: "Needs your input",
  generating: "Generating pages",
  generated_draft_only: "Pages are being polished",
  published_live: "Live",
};

function StatusPill({ status }: { status: string }) {
  const live = status === "published_live";
  const needs = status === "needs_info";
  const cls = live
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : needs
    ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-blue-100 text-blue-800 border-blue-200";
  return (
    <span className={`inline-flex items-center px-3 py-1 text-sm font-medium border rounded-full ${cls}`} data-testid="status-pill">
      {live ? "● " : ""}{STATUS_LABEL[status] || status}
    </span>
  );
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
      <div className={`${color} h-3 transition-all`} style={{ width: `${Math.min(100, score)}%` }} />
    </div>
  );
}

export default function CustomerDashboard() {
  const [, params] = useRoute("/dashboard/:token");
  const token = params?.token || "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/dashboard/data?token=${encodeURIComponent(token)}`);
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          if (!cancelled) setError(body.error || `Error ${r.status}`);
          return;
        }
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500" data-testid="text-loading">Loading your dashboard...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center" data-testid="error-card">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Dashboard unavailable</h1>
          <p className="text-gray-600">We could not find your dashboard. Please check your link or call (435) 999-5348 for assistance.</p>
        </div>
      </div>
    );
  }

  const stats = data.page_stats;
  const warm = data.warmup;
  const prot = data.protection;
  const gr = data.gap_report || {};

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500" data-testid="text-domain">{data.domain || "Your Site"}</div>
            <h1 className="text-2xl font-semibold text-gray-900" data-testid="text-brand-name">{data.brand_name}</h1>
          </div>
          <StatusPill status={data.status} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Summary headline */}
        {gr.summary && (
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100" data-testid="card-summary">
            <p className="text-gray-700 leading-relaxed">{gr.summary}</p>
          </div>
        )}

        {/* Pages */}
        {stats && (
          <section className="bg-white rounded-lg shadow-sm p-6 border border-gray-100" data-testid="card-pages">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Pages</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-3xl font-semibold text-gray-900" data-testid="text-live-pages">{stats.live_pages}</div>
                <div className="text-sm text-gray-500">Live pages</div>
              </div>
              <div>
                <div className="text-3xl font-semibold text-gray-900" data-testid="text-tier1">{stats.tier1_live}</div>
                <div className="text-sm text-gray-500">Top-tier pages</div>
              </div>
              <div>
                <div className="text-3xl font-semibold text-emerald-600" data-testid="text-new-this-week">+{stats.new_this_week}</div>
                <div className="text-sm text-gray-500">New this week</div>
              </div>
              <div>
                <div className="text-3xl font-semibold text-emerald-600" data-testid="text-promoted-this-week">+{stats.promoted_this_week}</div>
                <div className="text-sm text-gray-500">Promoted this week</div>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-500">Average page quality: <span className="font-medium text-gray-700">{stats.avg_quality}/100</span></div>
          </section>
        )}

        {/* Launch Health */}
        {data.launch_health && (
          <section className="bg-white rounded-lg shadow-sm p-6 border border-gray-100" data-testid="card-health">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Launch Health</h2>
              <div className="text-2xl font-semibold text-gray-900" data-testid="text-health-score">{data.launch_health.score}<span className="text-base text-gray-400">/100</span></div>
            </div>
            <HealthBar score={data.launch_health.score} />
            {data.launch_health.breakdown?.message && (
              <p className="mt-3 text-sm text-gray-600" data-testid="text-health-message">{data.launch_health.breakdown.message}</p>
            )}
          </section>
        )}

        {/* Status flags: warmup + protection */}
        {(warm?.active || prot?.active) && (
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-6" data-testid="card-status-flags">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">Site Status</h2>
            <ul className="space-y-2 text-sm text-blue-900">
              {warm?.active && (
                <li data-testid="text-warmup-status">
                  <strong>Staged rollout — day {warm.day} of 30.</strong> We are gradually increasing your page count to build trust with search engines.
                  {warm.page_limit !== null && ` Current limit: ${warm.page_limit} pages.`}
                  {warm.next_increase_day && warm.next_increase_limit && ` Next increase on day ${warm.next_increase_day} (up to ${warm.next_increase_limit} pages).`}
                </li>
              )}
              {prot?.active && (
                <li data-testid="text-protection-status">
                  <strong>Quality protection active.</strong> We are using stricter quality thresholds for your first 30 days to ensure only your strongest pages reach search engines.
                  {prot.expires_in_days !== null && ` Quality protection ends in ${prot.expires_in_days} day(s).`}
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Critical gaps & recommendations */}
        {(gr.critical_gaps?.length > 0 || gr.recommendations?.length > 0) && (
          <section className="bg-white rounded-lg shadow-sm p-6 border border-gray-100" data-testid="card-gaps">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Action Items</h2>
            {gr.critical_gaps?.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-medium text-red-700 mb-2 uppercase tracking-wide">Needs Attention</h3>
                <ul className="space-y-3">
                  {gr.critical_gaps.map((g: any, i: number) => (
                    <li key={i} className="border-l-4 border-red-400 bg-red-50 p-3 rounded-r" data-testid={`gap-critical-${i}`}>
                      <div className="font-medium text-red-900">{g.area}: {g.issue}</div>
                      <div className="text-sm text-red-800 mt-1">{g.action}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {gr.recommendations?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-amber-700 mb-2 uppercase tracking-wide">Recommended</h3>
                <ul className="space-y-3">
                  {gr.recommendations.map((g: any, i: number) => (
                    <li key={i} className="border-l-4 border-amber-300 bg-amber-50 p-3 rounded-r" data-testid={`gap-recommendation-${i}`}>
                      <div className="font-medium text-amber-900">{g.area}: {g.issue}</div>
                      <div className="text-sm text-amber-800 mt-1">{g.action}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Recent live pages */}
        {data.recent_pages.length > 0 && (
          <section className="bg-white rounded-lg shadow-sm p-6 border border-gray-100" data-testid="card-recent">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Live Pages</h2>
            <ul className="divide-y divide-gray-100">
              {data.recent_pages.map((p, i) => (
                <li key={p.slug} className="py-3 flex items-center justify-between" data-testid={`row-recent-${i}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.title}</div>
                    <div className="text-xs text-gray-500 truncate">/{p.slug}</div>
                  </div>
                  <div className="text-xs text-gray-500 ml-4 flex-shrink-0">
                    {p.tier === 1 ? "Top tier" : "Standard"} · {p.quality_score ?? 0}/100
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="text-center text-sm text-gray-500 py-8">
          Questions? Call <a className="text-blue-600 hover:underline" href="tel:+14359995348">(435) 999-5348</a>
          {data.booking_url && <> · <a className="text-blue-600 hover:underline" href={data.booking_url} target="_blank" rel="noopener">Book a call</a></>}
        </footer>
      </main>
    </div>
  );
}
