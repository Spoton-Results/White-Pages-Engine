import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Loader2, Play, XCircle, Zap } from "lucide-react";
import { api } from "@/lib/api";

type QueueItem = { bpId: string; locPayload: Record<string, any>; label: string };
type ProgressRow = { service: string; status: string; created: number; updated: number; skipped: number; errors: number };

async function apiFetch<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

function isTerminalStatus(status?: string) {
  return status === "completed" || status === "failed" || status === "error" || status === "cancelled";
}

function summarizeProgress(progress?: ProgressRow[]) {
  const rows = Array.isArray(progress) ? progress : [];
  return rows.reduce((acc, row) => {
    acc.created += (row.created ?? 0) + (row.updated ?? 0);
    acc.skipped += row.skipped ?? 0;
    acc.errors += row.errors ?? 0;
    return acc;
  }, { created: 0, skipped: 0, errors: 0 });
}

export default function BulkGeneratorPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [websiteId, setWebsiteId] = useState(() => new URLSearchParams(window.location.search).get("websiteId") || "");
  const [blueprintId, setBlueprintId] = useState("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [cycleBlueprints, setCycleBlueprints] = useState(true);
  const [runBothLocations, setRunBothLocations] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [serviceProgress, setServiceProgress] = useState<ProgressRow[]>([]);
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[]; warning?: string } | null>(null);
  const [lastFailure, setLastFailure] = useState("");
  const [bpQueueDisplay, setBpQueueDisplay] = useState({ idx: 0, total: 1, label: "" });

  const bpQueueRef = useRef<QueueItem[]>([]);
  const bpQueueIdxRef = useRef(0);
  const accumulatedRef = useRef({ created: 0, skipped: 0, errors: 0 });
  const handledTerminalJobRef = useRef("");

  const websitesQ = useQuery<any[]>({ queryKey: ["/api/websites"], queryFn: () => api.get<any[]>("/api/websites") });
  const websites = websitesQ.data ?? [];
  const selectedWebsite = websites.find((w: any) => w.id === websiteId);
  const accountId = selectedWebsite?.accountId || "";

  const servicesQ = useQuery<string[]>({ queryKey: ["/api/websites", websiteId, "variation-services"], queryFn: () => apiFetch(`/api/websites/${websiteId}/variation-services`), enabled: !!websiteId });
  const bankServicesQ = useQuery<string[]>({ queryKey: ["/api/websites", websiteId, "bank-services"], queryFn: () => apiFetch(`/api/websites/${websiteId}/bank-services`), enabled: !!websiteId });
  const locationsQ = useQuery<any[]>({ queryKey: ["/api/websites", websiteId, "locations"], queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/locations`), enabled: !!websiteId });
  const blueprintsQ = useQuery<any[]>({ queryKey: ["/api/accounts", accountId, "blueprints"], queryFn: () => api.get<any[]>(`/api/accounts/${accountId}/blueprints`), enabled: !!accountId });

  const activeJobQ = useQuery<any>({
    queryKey: ["/api/jobs/active", activeJobId],
    queryFn: () => api.get<any>(`/api/jobs/${activeJobId}`),
    enabled: !!activeJobId,
    refetchInterval: (query) => isTerminalStatus(query.state.data?.status) ? false : 2000,
    staleTime: 0,
  });

  const services = servicesQ.data ?? [];
  const bankServicesSet = new Set(bankServicesQ.data ?? []);
  const allLocations = locationsQ.data ?? [];
  const blueprints = blueprintsQ.data ?? [];

  const dbStates = useMemo(() => allLocations.filter((l: any) => l.type === "state"), [allLocations]);
  const dbCities = useMemo(() => allLocations.filter((l: any) => l.type === "city"), [allLocations]);

  useEffect(() => {
    const defaultId = selectedWebsite?.settings?.defaultBlueprintId;
    if (defaultId) setBlueprintId(defaultId);
  }, [selectedWebsite?.id]);

  useEffect(() => {
    const job = activeJobQ.data;
    if (!job) return;
    const progress = Array.isArray(job.settings?.progress) ? job.settings.progress : [];
    if (progress.length) setServiceProgress(progress);
    if (!isTerminalStatus(job.status)) return;
    if (handledTerminalJobRef.current === job.id) return;
    handledTerminalJobRef.current = job.id;

    const totals = summarizeProgress(progress);
    accumulatedRef.current.created += totals.created;
    accumulatedRef.current.skipped += totals.skipped;
    accumulatedRef.current.errors += totals.errors;

    qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    qc.invalidateQueries({ queryKey: ["/api/pages"] });
    qc.invalidateQueries({ queryKey: ["/api/websites"] });

    if (job.status === "completed") {
      const nextIdx = bpQueueIdxRef.current + 1;
      if (nextIdx < bpQueueRef.current.length) {
        bpQueueIdxRef.current = nextIdx;
        const nextItem = bpQueueRef.current[nextIdx];
        setBpQueueDisplay({ idx: nextIdx, total: bpQueueRef.current.length, label: nextItem.label });
        setServiceProgress(Array.from(selectedServices).map((service) => ({ service, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
        setActiveJobId("");
        submitJobForBlueprint(nextItem);
        return;
      }
      setIsRunningAll(false);
      setActiveJobId("");
      setLastResult({ ...accumulatedRef.current, slugs: [] });
      toast({ title: "Bulk generation complete", description: `${accumulatedRef.current.created.toLocaleString()} pages created or updated.` });
      return;
    }

    const message = job.settings?.fatalError || `Job ended with status: ${job.status}`;
    bpQueueRef.current = [];
    bpQueueIdxRef.current = 0;
    setIsRunningAll(false);
    setActiveJobId("");
    setLastFailure(message);
    setLastResult({ ...accumulatedRef.current, slugs: [], warning: message });
    toast({ title: "Bulk generation stopped", description: message, variant: "destructive" });
  }, [activeJobQ.data]);

  function resetForWebsite(nextWebsiteId: string) {
    setWebsiteId(nextWebsiteId);
    setBlueprintId("");
    setSelectedServices(new Set());
    setSelectedStateCodes(new Set());
    setSelectedCitySlugs(new Set());
    setServiceProgress([]);
    setLastResult(null);
    setLastFailure("");
    setActiveJobId("");
    setIsRunningAll(false);
    bpQueueRef.current = [];
    bpQueueIdxRef.current = 0;
    handledTerminalJobRef.current = "";
  }

  function buildStatePayload() {
    const states = Array.from(new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)));
    return states.length ? { mode: "specific_states", states } : { mode: "all_states" };
  }

  function buildCityPayload() {
    const source = runBothLocations && mode === "all_states" ? dbCities : Array.from(selectedCitySlugs).map((slug) => dbCities.find((l: any) => l.slug === slug)).filter(Boolean);
    return { mode: "specific_cities", cities: source.map((loc: any) => ({ name: loc.name, stateAbbr: loc.stateCode })) };
  }

  function buildLocationPayload() {
    if (mode === "all_states") return buildStatePayload();
    if (mode === "specific_states") return { mode: "specific_states", states: Array.from(selectedStateCodes) };
    return buildCityPayload();
  }

  async function submitJobForBlueprint(item: QueueItem) {
    try {
      const payload: Record<string, any> = { services: Array.from(selectedServices), ...item.locPayload, overwrite };
      if (item.bpId) payload.blueprintId = item.bpId;
      const data = await apiFetch<{ jobId: string }>(`/api/websites/${websiteId}/bulk-generate-job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      handledTerminalJobRef.current = "";
      setActiveJobId(data.jobId);
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    } catch (err: any) {
      setIsRunningAll(false);
      bpQueueRef.current = [];
      bpQueueIdxRef.current = 0;
      const message = err?.message || "Failed to start job";
      setLastFailure(message);
      toast({ title: "Failed to start job", description: message, variant: "destructive" });
    }
  }

  async function runAllServices() {
    if (!websiteId || selectedServices.size === 0) return;
    const bpIds = cycleBlueprints && blueprints.length > 1 ? blueprints.map((bp: any) => bp.id) : [blueprintId];
    const queue: QueueItem[] = runBothLocations
      ? [...bpIds.map((id, i) => ({ bpId: id, locPayload: buildStatePayload(), label: `State pages ${i + 1}/${bpIds.length}` })), ...bpIds.map((id, i) => ({ bpId: id, locPayload: buildCityPayload(), label: `City pages ${i + 1}/${bpIds.length}` }))]
      : bpIds.map((id, i) => ({ bpId: id, locPayload: buildLocationPayload(), label: `Blueprint ${i + 1}/${bpIds.length}` }));
    bpQueueRef.current = queue;
    bpQueueIdxRef.current = 0;
    accumulatedRef.current = { created: 0, skipped: 0, errors: 0 };
    handledTerminalJobRef.current = "";
    setBpQueueDisplay({ idx: 0, total: queue.length, label: queue[0].label });
    setLastResult(null);
    setLastFailure("");
    setIsRunningAll(true);
    setServiceProgress(Array.from(selectedServices).map((service) => ({ service, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
    await submitJobForBlueprint(queue[0]);
  }

  const targetCount = mode === "all_states" ? (dbStates.length || 50) : mode === "specific_states" ? selectedStateCodes.size : selectedCitySlugs.size;
  const estimatedPages = selectedServices.size * targetCount * (cycleBlueprints && blueprints.length > 1 ? blueprints.length : 1);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3"><div className="p-2 rounded-lg bg-primary/10"><Zap className="size-5 text-primary" /></div><div><h1 className="text-2xl font-bold">Hybrid Bulk Generator</h1><p className="text-muted-foreground text-sm">Stable background bulk generation with fixed terminal-status handling.</p></div></div>

        <Card><CardHeader><CardTitle>Select Website</CardTitle></CardHeader><CardContent><Select value={websiteId} onValueChange={resetForWebsite}><SelectTrigger className="max-w-md"><SelectValue placeholder="Choose a website..." /></SelectTrigger><SelectContent>{websites.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain ? `${w.settings.parentDomain}${w.settings.proxyPath || ""}` : w.domain}</SelectItem>)}</SelectContent></Select></CardContent></Card>

        {websiteId && <Card><CardHeader><CardTitle>Blueprint</CardTitle></CardHeader><CardContent className="space-y-3">{blueprints.map((bp: any) => <Button key={bp.id} variant={blueprintId === bp.id ? "default" : "outline"} size="sm" onClick={() => setBlueprintId(blueprintId === bp.id ? "" : bp.id)}>{bp.name}</Button>)}{blueprints.length > 1 && <label className="flex gap-2 items-center text-sm"><Checkbox checked={cycleBlueprints} onCheckedChange={(v) => setCycleBlueprints(!!v)} />Run all blueprints</label>}</CardContent></Card>}

        {websiteId && <Card><CardHeader><CardTitle>Configure</CardTitle><CardDescription>{estimatedPages.toLocaleString()} estimated page(s)</CardDescription></CardHeader><CardContent className="space-y-4"><div><Label>Services</Label><div className="border rounded-md p-2 max-h-48 overflow-y-auto">{services.map((service) => <label key={service} className="flex gap-2 items-center py-1 text-sm"><Checkbox checked={selectedServices.has(service)} onCheckedChange={(checked) => setSelectedServices((prev) => { const next = new Set(prev); checked ? next.add(service) : next.delete(service); return next; })} />{service}{!bankServicesSet.has(service) && <span className="text-xs text-amber-600">No banks</span>}</label>)}</div></div><div><Label>Location scope</Label><Select value={mode} onValueChange={(v: any) => setMode(v)}><SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_states">All states</SelectItem><SelectItem value="specific_states">Specific states</SelectItem><SelectItem value="specific_cities">Specific cities</SelectItem></SelectContent></Select></div>{mode === "specific_states" && <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto border rounded p-2">{dbStates.map((loc: any) => <label key={loc.slug} className="flex gap-2 text-sm"><Checkbox checked={selectedStateCodes.has(loc.stateCode)} onCheckedChange={(checked) => setSelectedStateCodes((prev) => { const next = new Set(prev); checked ? next.add(loc.stateCode) : next.delete(loc.stateCode); return next; })} />{loc.name}</label>)}</div>}{mode === "specific_cities" && <div><Input placeholder="Search cities" className="mb-2" /><div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto border rounded p-2">{dbCities.slice(0, 1000).map((loc: any) => <label key={loc.slug} className="flex gap-2 text-sm"><Checkbox checked={selectedCitySlugs.has(loc.slug)} onCheckedChange={(checked) => setSelectedCitySlugs((prev) => { const next = new Set(prev); checked ? next.add(loc.slug) : next.delete(loc.slug); return next; })} />{loc.name}, {loc.stateCode}</label>)}</div></div>}<label className="flex gap-2 items-center text-sm"><Checkbox checked={runBothLocations} onCheckedChange={(v) => setRunBothLocations(!!v)} />Generate both state and city pages</label><label className="flex gap-2 items-center text-sm"><Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(!!v)} />Overwrite existing pages</label></CardContent></Card>}

        {websiteId && selectedServices.size > 0 && <Card><CardHeader><CardTitle>Generate</CardTitle><CardDescription>Polling now stops on completed, failed, error, or cancelled. Chaining only continues after completed.</CardDescription></CardHeader><CardContent className="space-y-4"><Button size="lg" onClick={runAllServices} disabled={isRunningAll || targetCount === 0}><Play className="size-4 mr-2" />{isRunningAll ? "Running..." : `Generate ${estimatedPages.toLocaleString()} Pages`}</Button>{isRunningAll && activeJobId && <p className="text-xs text-muted-foreground"><Loader2 className="inline size-3 animate-spin mr-1" />Job {bpQueueDisplay.idx + 1} of {bpQueueDisplay.total}: {bpQueueDisplay.label}</p>}{serviceProgress.map((p) => <div key={p.service} className="flex items-center gap-2 border rounded px-3 py-2 text-sm">{p.status === "done" ? <CheckCircle2 className="size-4 text-green-600" /> : p.status === "error" ? <XCircle className="size-4 text-red-600" /> : <Loader2 className="size-4 animate-spin" />}<span className="flex-1">{p.service}</span><span className="text-xs text-muted-foreground">{p.status} · {p.created + p.updated} pages · {p.skipped} skipped · {p.errors} errors</span></div>)}{lastFailure && <div className="border border-red-200 bg-red-50 text-red-700 rounded p-3 text-sm">{lastFailure}</div>}{lastResult && !isRunningAll && <div className="border rounded p-3 text-sm">Generated/updated {lastResult.created.toLocaleString()} · skipped {lastResult.skipped.toLocaleString()} · errors {lastResult.errors.toLocaleString()}</div>}</CardContent></Card>}
      </div>
    </DashboardLayout>
  );
}
