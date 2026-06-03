import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useAccountContext } from "@/hooks/use-account-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Copy, ExternalLink, FileText, Globe2, Link2, MapPinned, RefreshCcw, Search, Share2, ShieldCheck, Sparkles, TrendingUp, Wrench } from "lucide-react";

interface Summary { activeClients: number; pagesLive: number; citiesCovered: number; servicesCovered: number; estimatedSearchReach: number; }
interface Activity { pagesGenerated: number; pagesImproved: number; linksAdded: number; faqExpansions: number; intentClustersBuilt: number; sitemapUpdates: number; contentRepairs: number; qualityFixes: number; }
interface Coverage { statesCovered: number; citiesCovered: number; cityCoveragePercentage: number; stateCoverage: { state_code: string; cities: number }[]; pageTypes: { stateHubs: number; cityHubs: number; cityService: number; industryCity: number; problemIntent: number; }; expansionOpportunities: { city: string; state: string; reason: string; population: number }[]; }
interface ClientBreakdown { id: string; name: string; status: string; pagesLive: number; citiesCovered: number; servicesCovered: number; estimatedSearchReach: number; last30DaysWork: number; last30Days: { pagesGenerated: number; linksAdded: number; pagesImproved: number; sitemapUpdates: number; jobsCompletedOrQueued: number; failedJobs: number; }; lastActivityAt: string | null; }
interface ClientDetail { client: { id: string; name: string; status: string }; summary: { pagesLive: number; citiesCovered: number; servicesCovered: number; estimatedSearchReach: number }; websites: { id: string; name: string; domain: string; status: string; onboarding_status: string | null }[]; pageTypes: Record<string, number>; topCities: { name: string; state_code: string; population: number }[]; topServices: { name: string; slug: string; pages_live: number }[]; workLog: { type: string; label: string; detail: string; createdAt: string }[]; expansionOpportunities: { city: string; state: string; reason: string; population: number }[]; health: { failedJobs: number; stuckJobs: number; thinBanks: number; warnings: string[] }; }
interface ShareResponse { ok: boolean; token: string; url: string; expiresDays: number; }

async function fetchJson<T>(url: string): Promise<T> { const res = await fetch(url, { credentials: "include" }); if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`); return res.json(); }
async function postJson<T>(url: string, body: unknown = {}): Promise<T> { const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`); return res.json(); }
function fmt(n?: number) { return Math.round(n || 0).toLocaleString(); }
function compact(n?: number) { const value = n || 0; if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M+`; if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K+`; return value.toLocaleString(); }
function openMonthlyReport(accountId: string) { window.open(`/api/agency-dashboard/clients/${accountId}/monthly-report`, "_blank", "noopener,noreferrer"); }

const emptySummary: Summary = { activeClients: 0, pagesLive: 0, citiesCovered: 0, servicesCovered: 0, estimatedSearchReach: 0 };
const emptyActivity: Activity = { pagesGenerated: 0, pagesImproved: 0, linksAdded: 0, faqExpansions: 0, intentClustersBuilt: 0, sitemapUpdates: 0, contentRepairs: 0, qualityFixes: 0 };
const emptyCoverage: Coverage = { statesCovered: 0, citiesCovered: 0, cityCoveragePercentage: 0, stateCoverage: [], pageTypes: { stateHubs: 0, cityHubs: 0, cityService: 0, industryCity: 0, problemIntent: 0 }, expansionOpportunities: [] };

export default function AgencyDashboardPage() {
  return (
    <DashboardLayout>
      <AgencyDashboardContent />
    </DashboardLayout>
  );
}

function AgencyDashboardContent() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [coverage, setCoverage] = useState<Coverage>(emptyCoverage);
  const [clients, setClients] = useState<ClientBreakdown[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientBreakdown | null>(null);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ✅ CHANGED: Read global Agency/Client switcher state so this dashboard can request scoped data.
  // 🔒 UNTOUCHED: Dropdown UI remains owned by DashboardLayout.
  const { selectedAgencyId, selectedAccountId } = useAccountContext();
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedAgencyId) params.set("agencyId", selectedAgencyId);
    if (selectedAccountId) params.set("accountId", selectedAccountId);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [selectedAgencyId, selectedAccountId]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, a, c, clientRows] = await Promise.all([
        fetchJson<Summary>(`/api/agency-dashboard/summary${filterQuery}`),
        fetchJson<Activity>(`/api/agency-dashboard/activity${filterQuery}`),
        fetchJson<Coverage>(`/api/agency-dashboard/coverage${filterQuery}`),
        fetchJson<ClientBreakdown[]>(`/api/agency-dashboard/clients${filterQuery}`),
      ]);
      setSummary(s); setActivity(a); setCoverage(c); setClients(clientRows);
    } catch (e: any) { setError(e.message || "Failed to load agency dashboard"); }
    finally { setLoading(false); }
  }

  async function openClientDetail(client: ClientBreakdown) {
    setSelectedClient(client);
    setClientDetail(null);
    setDetailLoading(true);
    try { setClientDetail(await fetchJson<ClientDetail>(`/api/agency-dashboard/clients/${client.id}`)); }
    catch (e: any) { setError(e.message || "Failed to load client detail"); }
    finally { setDetailLoading(false); }
  }

  async function createShareLink(accountId: string, mode: "copy" | "open" = "copy") {
    setShareBusyId(accountId + mode);
    setError(null);
    setShareNotice(null);
    try {
      const data = await postJson<ShareResponse>(`/api/agency-dashboard/clients/${accountId}/monthly-report/share`, { expiresDays: 90 });
      if (mode === "open") {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        await navigator.clipboard.writeText(data.url);
        setShareNotice("Shareable report link copied. It expires in 90 days.");
        setTimeout(() => setShareNotice(null), 5000);
      }
    } catch (e: any) {
      setError(e.message || "Failed to create share link");
    } finally {
      setShareBusyId(null);
    }
  }

  useEffect(() => { load(); }, [filterQuery]);

  const totalIntentPages = useMemo(() => { const p = coverage.pageTypes; return p.stateHubs + p.cityHubs + p.cityService + p.industryCity + p.problemIntent; }, [coverage]);
  const activityTotal = useMemo(() => Object.values(activity).reduce((sum, value) => sum + (Number(value) || 0), 0), [activity]);
  const detailPageTypes = clientDetail?.pageTypes || {};

  return (
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="flex items-center gap-2"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><TrendingUp className="h-5 w-5" /></div><h1 className="text-2xl font-bold tracking-tight text-gray-900">Executive ROI Dashboard</h1></div><p className="mt-2 max-w-3xl text-sm text-gray-500">Proof-of-work and market visibility dashboard for managed agency growth. Built to show clients what has been created, expanded, linked, and protected.</p></div>
          <div className="flex items-center gap-3"><Badge className="bg-green-100 text-green-800 hover:bg-green-100">Managed DFY View</Badge><Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />{loading ? "Refreshing..." : "Refresh"}</Button></div>
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {shareNotice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{shareNotice}</div>}

        <Card className="overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 text-white"><CardContent className="p-6 md:p-8"><div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-center"><div><div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100"><Search className="h-3.5 w-3.5" />Estimated Local Search Reach</div><div className="mt-5 text-5xl font-bold tracking-tight md:text-6xl">{compact(summary.estimatedSearchReach)}</div><p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100">Estimated monthly local search footprint based on live pages, city coverage, and service coverage. This is the headline ROI story agencies can repeat to clients.</p></div><div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur"><div className="flex items-center gap-2 text-sm font-medium text-indigo-100"><ShieldCheck className="h-4 w-4" />Monthly proof of execution</div><div className="mt-4 text-3xl font-bold">{fmt(activityTotal)}</div><p className="mt-1 text-xs text-indigo-100">visible infrastructure actions tracked this period</p></div></div></CardContent></Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-5"><Building2 className="h-5 w-5 text-blue-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.activeClients)}</p><p className="text-sm text-gray-500">Active Clients</p></CardContent></Card><Card><CardContent className="p-5"><FileText className="h-5 w-5 text-purple-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.pagesLive)}</p><p className="text-sm text-gray-500">Pages Live</p></CardContent></Card><Card><CardContent className="p-5"><MapPinned className="h-5 w-5 text-green-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.citiesCovered)}</p><p className="text-sm text-gray-500">Cities Covered</p></CardContent></Card><Card><CardContent className="p-5"><Wrench className="h-5 w-5 text-orange-600" /><p className="mt-4 text-3xl font-bold">{fmt(summary.servicesCovered)}</p><p className="text-sm text-gray-500">Services Covered</p></CardContent></Card></div>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-600" />Client ROI Breakdown</CardTitle><CardDescription>Click a client to open the detailed retention view, generate a report, or copy a shareable client-safe link.</CardDescription></CardHeader><CardContent><div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Pages Live</TableHead><TableHead className="text-right">Cities</TableHead><TableHead className="text-right">Services</TableHead><TableHead className="text-right">Est. Reach</TableHead><TableHead className="text-right">30-Day Work</TableHead><TableHead>Breakdown</TableHead><TableHead className="text-right">Report</TableHead></TableRow></TableHeader><TableBody>{clients.length === 0 ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-gray-500">No client ROI rows yet. Launch a client or generate pages first.</TableCell></TableRow> : clients.map(client => <TableRow key={client.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openClientDetail(client)}><TableCell><div className="font-medium text-gray-900">{client.name}</div><div className="mt-1 text-xs text-gray-500">{client.status || "active"}</div></TableCell><TableCell className="text-right font-semibold">{fmt(client.pagesLive)}</TableCell><TableCell className="text-right">{fmt(client.citiesCovered)}</TableCell><TableCell className="text-right">{fmt(client.servicesCovered)}</TableCell><TableCell className="text-right font-semibold">{compact(client.estimatedSearchReach)}</TableCell><TableCell className="text-right"><Badge className={client.last30DaysWork > 0 ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-gray-100 text-gray-700 hover:bg-gray-100"}>{fmt(client.last30DaysWork)} actions</Badge></TableCell><TableCell><div className="text-xs leading-5 text-gray-600">{fmt(client.last30Days.pagesGenerated)} pages · {fmt(client.last30Days.linksAdded)} links · {fmt(client.last30Days.pagesImproved)} improved · {fmt(client.last30Days.sitemapUpdates)} sitemap updates{client.last30Days.failedJobs > 0 ? ` · ${fmt(client.last30Days.failedJobs)} failed jobs` : ""}</div></TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" className="gap-1" onClick={(e) => { e.stopPropagation(); openMonthlyReport(client.id); }}><ExternalLink className="h-3.5 w-3.5" />View</Button><Button size="sm" variant="outline" className="gap-1" disabled={!!shareBusyId} onClick={(e) => { e.stopPropagation(); createShareLink(client.id, "copy"); }}><Copy className="h-3.5 w-3.5" />{shareBusyId === client.id + "copy" ? "..." : "Copy"}</Button></div></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-600" />We Built This For You</CardTitle><CardDescription>Visible proof that managed search infrastructure is being built, improved, linked, and protected.</CardDescription></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.pagesGenerated)}</p><p className="text-sm text-gray-500">Pages Generated This Month</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.pagesImproved)}</p><p className="text-sm text-gray-500">Pages Improved</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.linksAdded)}</p><p className="text-sm text-gray-500">Internal Links Added</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.faqExpansions)}</p><p className="text-sm text-gray-500">FAQ / Content Expansions</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.intentClustersBuilt)}</p><p className="text-sm text-gray-500">Intent Clusters Built</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.sitemapUpdates)}</p><p className="text-sm text-gray-500">Sitemap Updates</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.contentRepairs)}</p><p className="text-sm text-gray-500">Content Repairs</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-2xl font-bold">{fmt(activity.qualityFixes)}</p><p className="text-sm text-gray-500">Quality Fixes</p></div></div></CardContent></Card>

        <div className="grid gap-6 lg:grid-cols-3"><Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-600" />Market Coverage</CardTitle><CardDescription>Territory footprint across states, cities, and service intent.</CardDescription></CardHeader><CardContent className="space-y-5"><div><div className="flex items-center justify-between text-sm"><span className="font-medium text-gray-700">City coverage buildout</span><span className="font-bold text-gray-900">{coverage.cityCoveragePercentage}%</span></div><Progress value={coverage.cityCoveragePercentage} className="mt-2" /></div><div className="grid gap-4 md:grid-cols-3"><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(coverage.statesCovered)}</p><p className="text-sm text-gray-500">States Active</p></div><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(coverage.citiesCovered)}</p><p className="text-sm text-gray-500">Cities Loaded</p></div><div className="rounded-xl border p-4"><p className="text-2xl font-bold">{fmt(totalIntentPages)}</p><p className="text-sm text-gray-500">Intent Pages Live</p></div></div><div className="grid gap-2 md:grid-cols-5">{coverage.stateCoverage.slice(0, 10).map((s) => <div key={s.state_code} className="rounded-lg border bg-gray-50 p-3 text-center"><div className="font-bold">{s.state_code}</div><div className="text-xs text-gray-500">{s.cities} cities</div></div>)}</div></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-purple-600" />Intent Coverage</CardTitle><CardDescription>Page inventory by search architecture layer.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">State Hubs</span><span className="font-bold">{fmt(coverage.pageTypes.stateHubs)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">City Hubs</span><span className="font-bold">{fmt(coverage.pageTypes.cityHubs)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">City + Service</span><span className="font-bold">{fmt(coverage.pageTypes.cityService)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">Industry + City</span><span className="font-bold">{fmt(coverage.pageTypes.industryCity)}</span></div><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">Problem Intent</span><span className="font-bold">{fmt(coverage.pageTypes.problemIntent)}</span></div></CardContent></Card></div>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-green-600" />Expansion Opportunities</CardTitle><CardDescription>Markets that can support future expansion conversations and higher retainer opportunities.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{coverage.expansionOpportunities.slice(0, 10).map((o) => <div key={`${o.city}-${o.state}`} className="rounded-xl border bg-gray-50 p-4"><div className="flex items-center justify-between"><div className="font-semibold text-gray-900">{o.city}, {o.state}</div><CheckCircle2 className="h-4 w-4 text-green-600" /></div><div className="mt-2 text-xs text-gray-500">Population: {fmt(o.population)}</div><p className="mt-3 text-xs leading-5 text-gray-600">{o.reason}</p></div>)}{coverage.expansionOpportunities.length === 0 && <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">No expansion opportunities found yet. Load locations and run validation.</div>}</div></CardContent></Card>
      </div>

      <Sheet open={!!selectedClient} onOpenChange={(open) => { if (!open) { setSelectedClient(null); setClientDetail(null); } }}><SheetContent className="w-full overflow-y-auto sm:max-w-3xl"><SheetHeader><div className="flex items-start justify-between gap-4"><div><SheetTitle>{selectedClient?.name || "Client Detail"}</SheetTitle><SheetDescription>Client-level ROI proof, health, footprint, and expansion opportunities.</SheetDescription></div>{selectedClient && <div className="flex gap-2"><Button size="sm" variant="outline" className="gap-2" onClick={() => openMonthlyReport(selectedClient.id)}><ExternalLink className="h-4 w-4" />View</Button><Button size="sm" className="gap-2" disabled={!!shareBusyId} onClick={() => createShareLink(selectedClient.id, "copy")}><Share2 className="h-4 w-4" />{shareBusyId === selectedClient.id + "copy" ? "Creating..." : "Copy Share Link"}</Button></div>}</div></SheetHeader>{detailLoading && <div className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">Loading client detail...</div>}{clientDetail && <div className="mt-6 space-y-6"><div className="grid gap-3 sm:grid-cols-4"><div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-500">Pages Live</p><p className="mt-1 text-2xl font-bold">{fmt(clientDetail.summary.pagesLive)}</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-500">Cities</p><p className="mt-1 text-2xl font-bold">{fmt(clientDetail.summary.citiesCovered)}</p></div><div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-500">Services</p><p className="mt-1 text-2xl font-bold">{fmt(clientDetail.summary.servicesCovered)}</p></div><div className="rounded-xl border bg-indigo-50 p-4"><p className="text-xs text-indigo-700">Est. Reach</p><p className="mt-1 text-2xl font-bold text-indigo-900">{compact(clientDetail.summary.estimatedSearchReach)}</p></div></div>{clientDetail.health.warnings.length > 0 ? <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-700" /><div><p className="font-medium text-yellow-900">Health warnings</p><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-yellow-800">{clientDetail.health.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div></div></div> : <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">No major health warnings found for this client.</div>}<Card><CardHeader><CardTitle className="text-base">Websites</CardTitle></CardHeader><CardContent className="space-y-2">{clientDetail.websites.map(w => <div key={w.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="font-medium">{w.name}</div><div className="text-xs text-gray-500">{w.domain}</div></div><Badge variant="outline">{w.status}</Badge></div>)}</CardContent></Card><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Page Mix</CardTitle></CardHeader><CardContent className="space-y-2">{Object.entries(detailPageTypes).length === 0 ? <div className="text-sm text-gray-500">No page mix yet.</div> : Object.entries(detailPageTypes).map(([type, count]) => <div key={type} className="flex justify-between rounded-lg border p-2 text-sm"><span>{type}</span><strong>{fmt(count)}</strong></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Top Services</CardTitle></CardHeader><CardContent className="space-y-2">{clientDetail.topServices.map(s => <div key={s.slug} className="flex justify-between rounded-lg border p-2 text-sm"><span>{s.name}</span><strong>{fmt(s.pages_live)} pages</strong></div>)}</CardContent></Card></div><Card><CardHeader><CardTitle className="text-base">Top Cities</CardTitle></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-3">{clientDetail.topCities.map(c => <div key={`${c.name}-${c.state_code}`} className="rounded-lg border bg-gray-50 p-3"><div className="font-medium">{c.name}, {c.state_code}</div><div className="text-xs text-gray-500">Population: {fmt(c.population)}</div></div>)}</div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Last 30 Days Work Log</CardTitle></CardHeader><CardContent className="space-y-2">{clientDetail.workLog.length === 0 ? <div className="text-sm text-gray-500">No recent work log yet.</div> : clientDetail.workLog.map((item, idx) => <div key={`${item.type}-${idx}`} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><div className="font-medium text-sm">{item.label}</div><Badge variant="outline">{item.type}</Badge></div><div className="mt-1 text-xs text-gray-500">{item.detail} · {new Date(item.createdAt).toLocaleString()}</div></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Expansion Opportunities</CardTitle></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-2">{clientDetail.expansionOpportunities.map(o => <div key={`${o.city}-${o.state}`} className="rounded-lg border bg-gray-50 p-3"><div className="font-medium">{o.city}, {o.state}</div><div className="mt-1 text-xs text-gray-500">Population: {fmt(o.population)}</div><p className="mt-2 text-xs text-gray-600">{o.reason}</p></div>)}</div></CardContent></Card></div>}</SheetContent></Sheet>
  );
}
