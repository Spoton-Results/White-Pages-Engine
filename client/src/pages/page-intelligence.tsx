import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Activity, BarChart3, GitBranch, MousePointerClick, Network, RefreshCw, ShieldAlert, Wrench } from "lucide-react";

type Website = { id: string; name: string; domain: string; settings?: any };
type GraphPage = { id: string; slug: string; title: string; page_type: string; tier: number; quality_score: number; inbound_links: number; outbound_links: number; graph_score: number };
type OrphanPage = { id: string; slug: string; title: string; page_type: string; tier: number; quality_score: number };
type DepthPage = { id: string; slug: string; title: string; depth: number };
type ConversionEvent = { event_type: string; count: number };

function grade(score: number) {
  if (score >= 85) return { label: "A", tone: "bg-emerald-50 text-emerald-700 border-emerald-300" };
  if (score >= 70) return { label: "B", tone: "bg-blue-50 text-blue-700 border-blue-300" };
  if (score >= 55) return { label: "C", tone: "bg-amber-50 text-amber-700 border-amber-300" };
  return { label: "D", tone: "bg-red-50 text-red-700 border-red-300" };
}

function StatCard({ title, value, sub, icon }: { title: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><div className="text-2xl font-bold mt-1">{value}</div>{sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}</div><div className="text-primary">{icon}</div></div></div>;
}

function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} /></div>;
}

export default function PageIntelligencePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState("");

  const websitesQ = useQuery({ queryKey: ["/api/websites"], queryFn: () => api.get<Website[]>("/api/websites") });
  const websites = websitesQ.data || [];
  const selectedWebsite = websiteId || websites[0]?.id || "";

  const graphQ = useQuery({ queryKey: ["page-intelligence", selectedWebsite, "graph"], queryFn: () => api.get<{ pages: GraphPage[] }>(`/api/websites/${selectedWebsite}/page-intelligence/graph`), enabled: !!selectedWebsite });
  const orphanQ = useQuery({ queryKey: ["page-intelligence", selectedWebsite, "orphans"], queryFn: () => api.get<{ orphanCount: number; pages: OrphanPage[] }>(`/api/websites/${selectedWebsite}/page-intelligence/orphans`), enabled: !!selectedWebsite });
  const depthQ = useQuery({ queryKey: ["page-intelligence", selectedWebsite, "crawl-depth"], queryFn: () => api.get<{ buckets: Record<string, number>; pages: DepthPage[] }>(`/api/websites/${selectedWebsite}/page-intelligence/crawl-depth`), enabled: !!selectedWebsite });
  const conversionQ = useQuery({ queryKey: ["page-intelligence", selectedWebsite, "conversion"], queryFn: () => api.get<{ events: ConversionEvent[]; totalForms: number; topPages: Array<{ page: string; events: number }> }>(`/api/websites/${selectedWebsite}/conversion-analytics`), enabled: !!selectedWebsite });

  const repair = useMutation({
    mutationFn: () => api.post<{ linksCreated: number }>(`/api/websites/${selectedWebsite}/page-intelligence/repair-orphans`, {}),
    onSuccess: (data) => {
      toast({ title: "Orphan repair complete", description: `${data.linksCreated} internal links created.` });
      qc.invalidateQueries({ queryKey: ["page-intelligence", selectedWebsite] });
    },
    onError: (e: any) => toast({ title: "Repair failed", description: e.message, variant: "destructive" }),
  });

  const graph = graphQ.data?.pages || [];
  const orphans = orphanQ.data?.pages || [];
  const depthBuckets = depthQ.data?.buckets || {};
  const events = conversionQ.data?.events || [];
  const maxDepthBucket = Math.max(...Object.values(depthBuckets).map(Number), 1);
  const avgGraph = graph.length ? Math.round(graph.reduce((sum, p) => sum + Number(p.graph_score || 0), 0) / graph.length) : 0;
  const weakPages = graph.filter((p) => Number(p.graph_score || 0) < 55).length;
  const zeroOutbound = graph.filter((p) => Number(p.outbound_links || 0) === 0).length;

  const recommendations = useMemo(() => {
    const list: Array<{ title: string; body: string; impact: string }> = [];
    if (orphans.length) list.push({ title: "Repair orphan pages", body: `${orphans.length} published pages have no inbound links. Run orphan repair to restore crawl access.`, impact: "High" });
    if (zeroOutbound) list.push({ title: "Add outbound context", body: `${zeroOutbound} pages have no outbound links. These pages may act as crawl dead ends.`, impact: "High" });
    if (weakPages) list.push({ title: "Prioritize weak graph scores", body: `${weakPages} pages have a graph score below 55. Link them from hubs and related service pages.`, impact: "Medium" });
    if ((conversionQ.data?.totalForms || 0) === 0) list.push({ title: "Validate conversion capture", body: "No forms were recorded in the last 30 days. Test the public form and CTA placement.", impact: "High" });
    return list.slice(0, 6);
  }, [orphans.length, zeroOutbound, weakPages, conversionQ.data?.totalForms]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["page-intelligence", selectedWebsite] });
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Page Intelligence</h1>
            <p className="text-sm text-muted-foreground">Crawl depth, internal-link graph, orphan recovery, and conversion analytics.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={selectedWebsite} onValueChange={setWebsiteId}>
              <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Select website" /></SelectTrigger>
              <SelectContent>{websites.map((w) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain || w.domain}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={refreshAll}><RefreshCw className="size-4 mr-2" />Refresh</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <StatCard title="Graph Score" value={avgGraph || "—"} sub="Average link authority" icon={<Network className="size-5" />} />
          <StatCard title="Orphans" value={orphans.length >= 500 ? "500+" : orphans.length} sub="Zero inbound links" icon={<ShieldAlert className="size-5" />} />
          <StatCard title="Weak Pages" value={weakPages} sub="Graph score under 55" icon={<Activity className="size-5" />} />
          <StatCard title="Forms" value={conversionQ.data?.totalForms ?? "—"} sub="Last 30 days" icon={<MousePointerClick className="size-5" />} />
          <StatCard title="Tracked Events" value={events.reduce((s, e) => s + Number(e.count || 0), 0)} sub="Last 30 days" icon={<BarChart3 className="size-5" />} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><h2 className="font-semibold">Link Graph Scoring</h2><p className="text-xs text-muted-foreground">Lowest scores first so you can fix the biggest crawl leaks.</p></div>
              <Badge variant="outline">{graph.length.toLocaleString()} pages analyzed</Badge>
            </div>
            <div className="overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Grade</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
                <TableBody>{graph.slice(0, 20).map((p) => { const g = grade(Number(p.graph_score || 0)); return <TableRow key={p.id}><TableCell><div className="font-medium max-w-[420px] truncate">{p.title}</div><div className="font-mono text-xs text-muted-foreground truncate">/{p.slug}</div></TableCell><TableCell><Badge variant="outline" className={g.tone}>{g.label}</Badge></TableCell><TableCell className="text-right">{p.inbound_links}</TableCell><TableCell className="text-right">{p.outbound_links}</TableCell><TableCell className="text-right font-semibold">{p.graph_score}</TableCell></TableRow>; })}</TableBody>
              </Table>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between"><div><h2 className="font-semibold">Orphan Repair</h2><p className="text-xs text-muted-foreground">Auto-create contextual inbound links.</p></div><Wrench className="size-5 text-primary" /></div>
            <div className="text-4xl font-bold">{orphans.length}</div>
            <p className="text-sm text-muted-foreground">Pages with no inbound internal links.</p>
            <Button className="w-full" disabled={!selectedWebsite || repair.isPending || !orphans.length} onClick={() => repair.mutate()}>{repair.isPending ? "Repairing..." : "Repair Orphans"}</Button>
            <div className="space-y-2 max-h-72 overflow-auto">{orphans.slice(0, 10).map((p) => <div key={p.id} className="rounded-lg bg-muted/50 p-2"><div className="text-sm font-medium truncate">{p.title}</div><div className="text-xs font-mono text-muted-foreground truncate">/{p.slug}</div></div>)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div><h2 className="font-semibold">Crawl Depth Heatmap</h2><p className="text-xs text-muted-foreground">How far pages are from hubs / tier-one seeds.</p></div>
            <div className="space-y-3">{Object.entries(depthBuckets).sort(([a],[b]) => Number(a)-Number(b)).map(([depth, count]) => <div key={depth} className="grid grid-cols-[80px_1fr_56px] items-center gap-3"><div className="text-sm font-medium">Depth {depth}</div><Bar value={Number(count)} max={maxDepthBucket} /><div className="text-sm text-right text-muted-foreground">{Number(count).toLocaleString()}</div></div>)}</div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div><h2 className="font-semibold">Conversion Analytics</h2><p className="text-xs text-muted-foreground">Forms and click events from public pages.</p></div>
            <div className="space-y-3">{events.length ? events.map((e) => <div key={e.event_type} className="grid grid-cols-[160px_1fr_56px] items-center gap-3"><div className="text-sm font-medium capitalize">{e.event_type.replace(/_/g, " ")}</div><Bar value={Number(e.count)} max={Math.max(...events.map(x => Number(x.count)), 1)} /><div className="text-sm text-right text-muted-foreground">{e.count}</div></div>) : <p className="text-sm text-muted-foreground">No tracked events yet.</p>}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div><h2 className="font-semibold">Public Event Stream</h2><p className="text-xs text-muted-foreground">Top pages by tracked interactions.</p></div>
            {(conversionQ.data?.topPages || []).slice(0, 15).map((p) => <div key={p.page} className="flex items-center justify-between gap-3 border-b last:border-0 py-2"><span className="font-mono text-xs truncate">{p.page}</span><Badge variant="secondary">{p.events}</Badge></div>)}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div><h2 className="font-semibold">Internal-Link Recommendations</h2><p className="text-xs text-muted-foreground">Prioritized fixes from graph + conversion signals.</p></div>
            {recommendations.length ? recommendations.map((r) => <div key={r.title} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{r.title}</h3><Badge variant={r.impact === "High" ? "destructive" : "secondary"}>{r.impact}</Badge></div><p className="text-sm text-muted-foreground mt-1">{r.body}</p></div>) : <p className="text-sm text-muted-foreground">No urgent recommendations right now.</p>}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
