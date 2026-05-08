import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Building2, CheckCircle2, FileText, Globe2, Link2, MapPinned, RefreshCcw, Search, ShieldCheck, Sparkles, TrendingUp, Wrench } from "lucide-react";

interface Summary { activeClients: number; pagesLive: number; citiesCovered: number; servicesCovered: number; estimatedSearchReach: number; }
interface Activity { pagesGenerated: number; pagesImproved: number; linksAdded: number; faqExpansions: number; intentClustersBuilt: number; sitemapUpdates: number; contentRepairs: number; qualityFixes: number; }
interface Coverage { statesCovered: number; citiesCovered: number; cityCoveragePercentage: number; stateCoverage: { state_code: string; cities: number }[]; pageTypes: { stateHubs: number; cityHubs: number; cityService: number; industryCity: number; problemIntent: number; }; expansionOpportunities: { city: string; state: string; reason: string; population: number }[]; }
interface ClientBreakdown { id: string; name: string; status: string; pagesLive: number; citiesCovered: number; servicesCovered: number; estimatedSearchReach: number; last30DaysWork: number; last30Days: { pagesGenerated: number; linksAdded: number; pagesImproved: number; sitemapUpdates: number; jobsCompletedOrQueued: number; failedJobs: number; }; lastActivityAt: string | null; }

async function fetchJson<T>(url: string): Promise<T> { const res = await fetch(url, { credentials: "include" }); if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`); return res.json(); }
function fmt(n?: number) { return Math.round(n || 0).toLocaleString(); }
function compact(n?: number) { const value = n || 0; if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M+`; if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K+`; return value.toLocaleString(); }

const emptySummary: Summary = { activeClients: 0, pagesLive: 0, citiesCovered: 0, servicesCovered: 0, estimatedSearchReach: 0 };
const emptyActivity: Activity = { pagesGenerated: 0, pagesImproved: 0, linksAdded: 0, faqExpansions: 0, intentClustersBuilt: 0, sitemapUpdates: 0, contentRepairs: 0, qualityFixes: 0 };
const emptyCoverage: Coverage = { statesCovered: 0, citiesCovered: 0, cityCoveragePercentage: 0, stateCoverage: [], pageTypes: { stateHubs: 0, cityHubs: 0, cityService: 0, industryCity: 0, problemIntent: 0 }, expansionOpportunities: [] };

export default function AgencyDashboardPage() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [coverage, setCoverage] = useState<Coverage>(emptyCoverage);
  const [clients, setClients] = useState<ClientBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, a, c, clientRows] = await Promise.all([
        fetchJson<Summary>("/api/agency-dashboard/summary"),
        fetchJson<Activity>("/api/agency-dashboard/activity"),
        fetchJson<Coverage>("/api/agency-dashboard/coverage"),
        fetchJson<ClientBreakdown[]>("/api/agency-dashboard/clients"),
      ]);
      setSummary(s); setActivity(a); setCoverage(c); setClients(clientRows);
    } catch (e: any) { setError(e.message || "Failed to load agency dashboard"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const totalIntentPages = useMemo(() => { const p = coverage.pageTypes; return p.stateHubs + p.cityHubs + p.cityService + p.industryCity + p.problemIntent; }, [coverage]);
  const activityTotal = useMemo(() => Object.values(activity).reduce((sum, value) => sum + (Number(value) || 0), 0), [activity]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><TrendingUp className="h-5 w-5" /></div><h1 className="text-2xl font-bold tracking-tight text-gray-900">Executive ROI Dashboard</h1></div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">Proof-of-work and market visibility dashboard for managed agency growth. Built to show clients what has been created, expanded, linked, and protected.</p>
          </div>
          <div className="flex items-center gap-3"><Badge className="bg-green-100 text-green-800 hover:bg-green-100">Managed DFY View</Badge><Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />{loading ? "Refreshing..." : "Refresh"}</Button></div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <Card className="overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 text-white">
          <CardContent className="p-6 md:p-8"><div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-center"><div><div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100"><Search className="h-3.5 w-3.5" />Estimated Local Search Reach</div><div className="mt-5 text-5xl font-bold tracking-tight md:text-6xl">{compact(summary.estimatedSearchReach)}</div><p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100">Estimated monthly local search footprint based on live pages, city coverage, and service coverage. This is the headline ROI story agencies can repeat to clients.</p></div><div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur"><div className="flex items-center gap-2 text-sm font-medium text-indigo-100"><ShieldCheck className="h-4 w-4" />Monthly proof of execution</div><div className="mt-4 text-3xl font-bold">{fmt(activityTotal)}</div><p className="mt-1 text-xs text-indigo-100">visible infrastructure actions tracked this period</p></div></div></CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-5"><Building2 className="h-5 w-5 text-blue-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.activeClients)}</p><p className="text-sm text-gray-500">Active Clients</p></CardContent></Card>
          <Card><CardContent className="p-5"><FileText className="h-5 w-5 text-purple-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.pagesLive)}</p><p className="text-sm text-gray-500">Pages Live</p></CardContent></Card>
          <Card><CardContent className="p-5"><MapPinned className="h-5 w-5 text-green-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.citiesCovered)}</p><p className="text-sm text-gray-500">Cities Covered</p></CardContent></Card>
          <Card><CardContent className="p-5"><Wrench className="h-5 w-5 text-orange-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.servicesCovered)}</p><p className="text-sm text-gray-500">Services Covered</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-600" />Client ROI Breakdown</CardTitle><CardDescription>Client-level retention view: live footprint, coverage, estimated search reach, and last 30 days of visible work.</CardDescription></CardHeader>
          <CardContent><div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Pages Live</TableHead><TableHead className="text-right">Cities</TableHead><TableHead className="text-right">Services</TableHead><TableHead className="text-right">Est. Reach</TableHead><TableHead className="text-right">30-Day Work</TableHead><TableHead>Breakdown</TableHead></TableRow></TableHeader><TableBody>{clients.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-gray-500">No client ROI rows yet. Launch a client or generate pages first.</TableCell></TableRow> : clients.map(client => <TableRow key={client.id}><TableCell><div className="font-medium text-gray-900">{client.name}</div><div className="mt-1 text-xs text-gray-500">{client.status || "active"}</div></TableCell><TableCell className="text-right font-semibold">{fmt(client.pagesLive)}</TableCell><TableCell className="text-right">{fmt(client.citiesCovered)}</TableCell><TableCell className="text-right">{fmt(client.servicesCovered)}</TableCell><TableCell className="text-right font-semibold">{compact(client.estimatedSearchReach)}</TableCell><TableCell className="text-right"><Badge className={client.last30DaysWork > 0 ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-gray-100 text-gray-700 hover:bg-gray-100"}>{fmt(client.last30DaysWork)} actions</Badge></TableCell><TableCell><div className="text-xs leading-5 text-gray-600">{fmt(client.last30Days.pagesGenerated)} pages · {fmt(client.last30Days.linksAdded)} links · {fmt(client.last30Days.pagesImproved)} improved · {fmt(client.last30Days.sitemapUpdates)} sitemap updates{client.last30Days.failedJobs > 0 ? ` · ${fmt(client.last30Days.failedJobs)} failed jobs` : ""}</div></TableCell></TableRow>)}</TableBody></Table></div></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-600" />We Built This For You</CardTitle><CardDescription>Visible proof that managed search infrastructure is being built, improved, linked, and protected.</CardDescription></CardHeader>
          <CardContent><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.pagesGenerated)}</p><p className="text-sm text-gray-500">Pages Generated This Month</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.pagesImproved)}</p><p className="text-sm text-gray-500">Pages Improved</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.linksAdded)}</p><p className="text-sm text-gray-500">Internal Links Added</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.faqExpansions)}</p><p className="text-sm text-gray-500">FAQ / Content Expansions</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.intentClustersBuilt)}</p><p className="text-sm text-gray-500">Intent Clusters Built</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.sitemapUpdates)}</p><p className="text-sm text-gray-500">Sitemap Updates</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.contentRepairs)}</p><p className="text-sm text-gray-500">Content Repairs</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.qualityFixes)}</p><p className="text-sm text-gray-500">Quality Fixes</p></div></div></CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-600" />Market Coverage</CardTitle><CardDescription>Territory footprint across states, cities, and service intent.</CardDescription></CardHeader><CardContent className="space-y-5"><div><div className="flex items-center justify-between text-sm"><span className="font-medium text-gray-700">City coverage buildout</span><span className="font-bold text-gray-900">{coverage.cityCoveragePercentage}%</span></div><Progress value={coverage.cityCoveragePercentage} className="mt-2" /></div><div className="grid gap-4 md:grid-cols-3"><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(coverage.statesCovered)}</p><p className="text-sm text-gray-500">States Active</p></div><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(coverage.citiesCovered)}</p><p className="text-sm text-gray-500">Cities Loaded</p></div><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(totalIntentPages)}</p><p className="text-sm text-gray-500">Intent Pages Live</p></div></div><div className="grid gap-2 md:grid-cols-5">{coverage.stateCoverage.slice(0, 10).map((s) => <div key={s.state_code} className="rounded-lg border bg-gray-50 p-3 text-center"><div className="font-bold">{s.state_code}</div><div className="text-xs text-gray-500">{s.cities} cities</div></div>)}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-purple-600" />Intent Coverage</CardTitle><CardDescription>Page inventory by search architecture layer.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">State Hubs</span><span className="font-bold">{fmt(coverage.pageTypes.stateHubs)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">City Hubs</span><span className="font-bold">{fmt(coverage.pageTypes.cityHubs)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">City + Service</span><span className="font-bold">{fmt(coverage.pageTypes.cityService)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">Industry + City</span><span className="font-bold">{fmt(coverage.pageTypes.industryCity)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">Problem Intent</span><span className="font-bold">{fmt(coverage.pageTypes.problemIntent)}</span></div></CardContent></Card>
        </div>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-green-600" />Expansion Opportunities</CardTitle><CardDescription>Markets that can support future expansion conversations and higher retainer opportunities.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{coverage.expansionOpportunities.slice(0, 10).map((o) => <div key={`${o.city}-${o.state}`} className="rounded-xl border bg-gray-50 p-4"><div className="flex items-center justify-between"><div className="font-semibold text-gray-900">{o.city}, {o.state}</div><CheckCircle2 className="h-4 w-4 text-green-600" /></div><div className="mt-2 text-xs text-gray-500">Population: {fmt(o.population)}</div><p className="mt-3 text-xs leading-5 text-gray-600">{o.reason}</p></div>)}{coverage.expansionOpportunities.length === 0 && <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">No expansion opportunities found yet. Load locations and run validation.</div>}</div></CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
