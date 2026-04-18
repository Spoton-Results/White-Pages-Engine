import { useState, useMemo, useEffect, useRef } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, Play, CheckCircle2, Loader2, Search, FileText, XCircle, AlertCircle, Repeat2 } from "lucide-react";
import { api } from "@/lib/api";

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function BulkGeneratorPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [websiteId, setWebsiteId] = useState<string>(() => new URLSearchParams(window.location.search).get("websiteId") || "");
  const [blueprintId, setBlueprintId] = useState<string>("");
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(new Set());
  const [clusterSearch, setClusterSearch] = useState("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[]; warning?: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [cycleBlueprints, setCycleBlueprints] = useState(true);
  const [runBothLocations, setRunBothLocations] = useState(false);
  const [showBlueprintList, setShowBlueprintList] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const lastCityIdx = useRef<number | null>(null);
  const lastStateIdx = useRef<number | null>(null);
  type QueueItem = { bpId: string; locPayload: object; label: string };
  const bpQueueRef = useRef<QueueItem[]>([]);
  const bpQueueIdxRef = useRef(0);
  const [bpQueueDisplay, setBpQueueDisplay] = useState({ idx: 0, total: 1, label: "" });
  const accumulatedRef = useRef({ created: 0, skipped: 0, errors: 0 });
  const [serviceProgress, setServiceProgress] = useState<Array<{ service: string; status: "pending" | "running" | "done" | "error" | "no-bank"; created: number; updated: number; skipped: number; errors: number }>>([]);
  const [activeJobId, setActiveJobId] = useState<string>("");
  const [topCitiesLimit, setTopCitiesLimit] = useState<number | "all" | null>(null);
  const [cityTierFilter, setCityTierFilter] = useState<number | null>(null);

  const websitesQ = useQuery<any[]>({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const servicesQ = useQuery<string[]>({
    queryKey: ["/api/websites", websiteId, "variation-services"],
    queryFn: () => apiFetch(`/api/websites/${websiteId}/variation-services`),
    enabled: !!websiteId,
  });

  // Only services that already have variation banks written
  const bankServicesQ = useQuery<string[]>({
    queryKey: ["/api/websites", websiteId, "bank-services"],
    queryFn: () => apiFetch(`/api/websites/${websiteId}/bank-services`),
    enabled: !!websiteId,
  });

  const locationsQ = useQuery<any[]>({
    queryKey: ["/api/websites", websiteId, "locations"],
    queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/locations`),
    enabled: !!websiteId,
  });

  const websites = websitesQ.data ?? [];
  const selectedWebsite = websites.find((w: any) => w.id === websiteId);
  const accountId = selectedWebsite?.accountId || "";

  const blueprintsQ = useQuery<any[]>({
    queryKey: ["/api/accounts", accountId, "blueprints"],
    queryFn: () => api.get<any[]>(`/api/accounts/${accountId}/blueprints`),
    enabled: !!accountId,
  });

  const clustersQ = useQuery<any[]>({
    queryKey: ["/api/accounts", accountId, "query-clusters"],
    queryFn: () => apiFetch(`/api/accounts/${accountId}/query-clusters`),
    enabled: !!accountId,
  });

  // Poll the active background job every 2 s; stops when it completes or errors
  const activeJobQ = useQuery<any>({
    queryKey: ["/api/jobs/active", activeJobId],
    queryFn: () => api.get<any>(`/api/jobs/${activeJobId}`),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return (status === "completed" || status === "error") ? false : 2000;
    },
    staleTime: 0,
  });

  // Sync job progress → local state; chain next blueprint when one job completes
  useEffect(() => {
    const job = activeJobQ.data;
    if (!job) return;
    const progress = job.settings?.progress;
    if (progress) setServiceProgress(progress);

    if (job.status === "completed" || job.status === "error") {
      // Accumulate totals from this blueprint's run
      if (progress) {
        accumulatedRef.current.created += progress.reduce((s: number, p: any) => s + (p.created ?? 0) + (p.updated ?? 0), 0);
        accumulatedRef.current.skipped += progress.reduce((s: number, p: any) => s + (p.skipped ?? 0), 0);
        accumulatedRef.current.errors  += progress.reduce((s: number, p: any) => s + (p.errors ?? 0), 0);
      }
      const nextIdx = bpQueueIdxRef.current + 1;
      if (nextIdx < bpQueueRef.current.length) {
        // Start next item in the queue
        bpQueueIdxRef.current = nextIdx;
        const nextItem = bpQueueRef.current[nextIdx];
        setBpQueueDisplay({ idx: nextIdx, total: bpQueueRef.current.length, label: nextItem.label });
        const svcNames: string[] = (job.settings?.services as string[]) ?? [];
        setServiceProgress(svcNames.map(s => ({ service: s, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
        setActiveJobId("");
        submitJobForBlueprint(nextItem);
      } else {
        // All blueprints done
        setIsRunningAll(false);
        setLastResult({ ...accumulatedRef.current, slugs: [] });
        qc.invalidateQueries({ queryKey: ["/api/pages"] });
        qc.invalidateQueries({ queryKey: ["/api/websites"] });
      }
    }
  }, [activeJobQ.data]);

  const services = servicesQ.data ?? [];
  const bankServicesSet = new Set<string>(bankServicesQ.data ?? []);
  const allLocations = locationsQ.data ?? [];
  const blueprints = blueprintsQ.data ?? [];
  const clusters = clustersQ.data ?? [];

  // Deduplicate by slug so cities imported twice don't appear twice
  const dbStates = useMemo(() => {
    const seen = new Set<string>();
    return allLocations.filter((l: any) => {
      if (l.type !== "state") return false;
      if (seen.has(l.slug)) return false;
      seen.add(l.slug); return true;
    });
  }, [allLocations]);
  const dbCities = useMemo(() => {
    const seen = new Set<string>();
    return allLocations.filter((l: any) => {
      if (l.type !== "city") return false;
      if (seen.has(l.slug)) return false;
      seen.add(l.slug); return true;
    });
  }, [allLocations]);

  const dbCitiesByPop = useMemo(() =>
    [...dbCities].sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0)),
  [dbCities]);

  const filteredStates = useMemo(() => {
    lastStateIdx.current = null;
    const f = dbStates.filter((l: any) => !stateSearch || l.name.toLowerCase().includes(stateSearch.toLowerCase()) || l.stateCode?.toLowerCase().includes(stateSearch.toLowerCase()));
    return [...f].sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [dbStates, stateSearch]);

  const filteredCities = useMemo(() => {
    lastCityIdx.current = null;
    const f = dbCities.filter((l: any) => !citySearch || l.name.toLowerCase().includes(citySearch.toLowerCase()) || l.stateCode?.toLowerCase().includes(citySearch.toLowerCase()));
    if (topCitiesLimit !== null || cityTierFilter !== null) {
      return [...f].sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0));
    }
    return [...f].sort((a: any, b: any) => a.name.localeCompare(b.name) || a.stateCode?.localeCompare(b.stateCode));
  }, [dbCities, citySearch, topCitiesLimit, cityTierFilter]);

  // Auto-select default blueprint when website changes
  useEffect(() => {
    const defaultId = selectedWebsite?.settings?.defaultBlueprintId;
    if (defaultId) setBlueprintId(defaultId);
  }, [selectedWebsite?.id]);

  function buildCityPayload() {
    const cityObjs = Array.from(selectedCitySlugs).map(slug => {
      const loc = dbCities.find((l: any) => l.slug === slug);
      return loc ? { name: loc.name, stateAbbr: loc.stateCode } : null;
    }).filter(Boolean);
    return { mode: "specific_cities", cities: cityObjs };
  }

  function buildStatePayload() {
    const uniqueCodes = Array.from(new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)));
    return uniqueCodes.length > 0
      ? { mode: "specific_states", states: uniqueCodes }
      : { mode: "all_states" };
  }

  function buildLocationPayload() {
    if (mode === "all_states") return buildStatePayload();
    if (mode === "specific_states") return { mode: "specific_states", states: Array.from(selectedStateCodes) };
    return buildCityPayload();
  }

  async function submitJobForBlueprint(item: { bpId: string; locPayload: object }) {
    try {
      const svcs = Array.from(selectedServices);
      const payload: any = { services: svcs, ...item.locPayload, overwrite };
      if (item.bpId) payload.blueprintId = item.bpId;
      if (selectedClusterIds.size > 0) payload.queryClusterIds = Array.from(selectedClusterIds);
      const data: any = await apiFetch(`/api/websites/${websiteId}/bulk-generate-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setActiveJobId(data.jobId);
    } catch (err: any) {
      // Stop the entire queue on rejection — don't keep firing rejected jobs
      setIsRunningAll(false);
      bpQueueRef.current = [];
      bpQueueIdxRef.current = 0;
      const msg = err?.body?.message || err?.message || "Failed to start job";
      toast({
        title: "Failed to start job",
        description: msg,
        variant: "destructive",
      });
    }
  }

  async function runAllServices() {
    const svcs = Array.from(selectedServices);
    if (svcs.length === 0) return;

    const bpIds = cycleBlueprints && blueprints.length > 1
      ? blueprints.map((bp: any) => bp.id)
      : [blueprintId];

    const cityPayload = buildCityPayload();
    const statePayload = buildStatePayload();
    const currentPayload = buildLocationPayload();

    // Build full queue: if runBothLocations, do states pass then cities pass
    let queue: Array<{ bpId: string; locPayload: object; label: string }>;
    if (runBothLocations) {
      const stateItems = bpIds.map((id, i) => ({ bpId: id, locPayload: statePayload, label: `State pages — Blueprint ${i + 1} of ${bpIds.length}` }));
      const cityItems  = bpIds.map((id, i) => ({ bpId: id, locPayload: cityPayload,  label: `City pages — Blueprint ${i + 1} of ${bpIds.length}` }));
      queue = [...stateItems, ...cityItems];
    } else {
      queue = bpIds.map((id, i) => ({ bpId: id, locPayload: currentPayload, label: `Blueprint ${i + 1} of ${bpIds.length}` }));
    }

    bpQueueRef.current = queue;
    bpQueueIdxRef.current = 0;
    accumulatedRef.current = { created: 0, skipped: 0, errors: 0 };
    setBpQueueDisplay({ idx: 0, total: queue.length, label: queue[0].label });

    setLastResult(null);
    setActiveJobId("");
    setServiceProgress(svcs.map(s => ({ service: s, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
    setIsRunningAll(true);

    await submitJobForBlueprint(queue[0]);

    if (queue.length > 1) {
      toast({
        title: `Running ${queue.length} jobs in sequence`,
        description: runBothLocations
          ? `${bpIds.length} blueprints × state pages, then ${bpIds.length} blueprints × city pages — all automatic.`
          : "Each blueprint will start automatically when the previous one finishes.",
      });
    } else {
      toast({
        title: "Job running in background",
        description: "You can close this tab or switch apps — the job will keep running on the server.",
      });
    }
  }

  const allStatesPayloadCount = useMemo(() => {
    if (dbStates.length === 0) return 50;
    const unique = new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean));
    return unique.size;
  }, [dbStates]);

  const targetCount = mode === "all_states"
    ? allStatesPayloadCount
    : mode === "specific_states"
    ? selectedStateCodes.size
    : selectedCitySlugs.size;

  const allStatesSelected = filteredStates.length > 0 && filteredStates.every((l: any) => selectedStateCodes.has(l.stateCode));
  const allCitiesSelected = filteredCities.length > 0 && filteredCities.every((l: any) => selectedCitySlugs.has(l.slug));

  const clusterCountForEstimate = selectedClusterIds.size > 0 ? selectedClusterIds.size : (clusters.length > 0 ? clusters.length : 1);

  // Detect when the selected blueprint will deduplicate city targets to state-level slugs.
  // This happens when the slug template uses {state} but NOT {location} or {city}.
  const activeBlueprintObj = blueprints.find((bp: any) => bp.id === blueprintId);
  const bpSlug = activeBlueprintObj?.slugTemplate ?? "";
  const blueprintDedupesCities = blueprintId
    && mode === "specific_cities"
    && /\{state/i.test(bpSlug)
    && !/\{location|\{city/i.test(bpSlug);
  const uniqueStateCountFromCities = useMemo(() => {
    if (!blueprintDedupesCities) return 0;
    const states = new Set<string>();
    for (const slug of Array.from(selectedCitySlugs)) {
      const loc = dbCities.find((l: any) => l.slug === slug);
      if (loc?.stateCode) states.add(loc.stateCode.toUpperCase());
    }
    return states.size;
  }, [blueprintDedupesCities, selectedCitySlugs, dbCities]);

  const effectiveTargetCount = blueprintDedupesCities ? uniqueStateCountFromCities : targetCount;
  const estimatedPages = selectedServices.size * clusterCountForEstimate * effectiveTargetCount;

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const cityGroups = useMemo(() => {
    const groups: Record<string, typeof filteredCities> = {};
    filteredCities.forEach((c: any) => {
      const letter = c.name?.[0]?.toUpperCase() ?? "#";
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(c);
    });
    return groups;
  }, [filteredCities]);

  const cityIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    filteredCities.forEach((c: any, i: number) => m.set(c.slug, i));
    return m;
  }, [filteredCities]);

  const cityAvailableLetters = useMemo(() => new Set(Object.keys(cityGroups)), [cityGroups]);

  function isCityLetterFullySelected(letter: string): boolean {
    return (cityGroups[letter] ?? []).every((c: any) => selectedCitySlugs.has(c.slug));
  }

  function isCityLetterPartial(letter: string): boolean {
    const g: any[] = cityGroups[letter] ?? [];
    return g.some((c: any) => selectedCitySlugs.has(c.slug)) && !isCityLetterFullySelected(letter);
  }

  function toggleCityLetter(letter: string): void {
    const g: any[] = cityGroups[letter] ?? [];
    if (!g.length) return;
    const allSel = isCityLetterFullySelected(letter);
    setSelectedCitySlugs(prev => {
      const n = new Set(prev);
      g.forEach((c: any) => (allSel ? n.delete(c.slug) : n.add(c.slug)));
      return n;
    });
  }

  function clearAllCities(): void {
    setSelectedCitySlugs(new Set());
    setTopCitiesLimit(null);
    setCityTierFilter(null);
  }

  function applyTopCities(v: string) {
    setCityTierFilter(null);
    if (v === "all") {
      setTopCitiesLimit("all");
      setSelectedCitySlugs(new Set(dbCitiesByPop.map((c: any) => c.slug)));
    } else {
      const n = Number(v);
      setTopCitiesLimit(n);
      setSelectedCitySlugs(new Set(dbCitiesByPop.slice(0, n).map((c: any) => c.slug)));
    }
  }

  function applyTierFilter(tier: number) {
    const newTier = cityTierFilter === tier ? null : tier;
    setCityTierFilter(newTier);
    setTopCitiesLimit(null);
    if (newTier === null) {
      setSelectedCitySlugs(new Set());
      return;
    }
    const selected = dbCitiesByPop.filter((c: any) => c.cityTier === newTier);
    setSelectedCitySlugs(new Set(selected.map((c: any) => c.slug)));
  }

  function handleCityClick(e: React.MouseEvent, idx: number, slug: string) {
    e.preventDefault();
    setSelectedCitySlugs(prev => {
      const n = new Set(prev);
      if (e.shiftKey && lastCityIdx.current !== null) {
        const lo = Math.min(lastCityIdx.current, idx);
        const hi = Math.max(lastCityIdx.current, idx);
        const selecting = !prev.has(slug);
        for (let i = lo; i <= hi; i++) {
          const s = filteredCities[i]?.slug;
          if (s) selecting ? n.add(s) : n.delete(s);
        }
      } else {
        n.has(slug) ? n.delete(slug) : n.add(slug);
      }
      lastCityIdx.current = idx;
      return n;
    });
  }

  function handleStateClick(e: React.MouseEvent, idx: number, code: string) {
    e.preventDefault();
    setSelectedStateCodes(prev => {
      const n = new Set(prev);
      if (e.shiftKey && lastStateIdx.current !== null) {
        const lo = Math.min(lastStateIdx.current, idx);
        const hi = Math.max(lastStateIdx.current, idx);
        const selecting = !prev.has(code);
        for (let i = lo; i <= hi; i++) {
          const c = filteredStates[i]?.stateCode;
          if (c) selecting ? n.add(c) : n.delete(c);
        }
      } else {
        n.has(code) ? n.delete(code) : n.add(code);
      }
      lastStateIdx.current = idx;
      return n;
    });
  }
  function selectAllStates() {
    setSelectedStateCodes(prev => {
      const n = new Set(prev);
      if (allStatesSelected) filteredStates.forEach((l: any) => n.delete(l.stateCode));
      else filteredStates.forEach((l: any) => n.add(l.stateCode));
      return n;
    });
  }
  function selectAllCities() {
    setSelectedCitySlugs(prev => {
      const n = new Set(prev);
      if (allCitiesSelected) filteredCities.forEach((l: any) => n.delete(l.slug));
      else filteredCities.forEach((l: any) => n.add(l.slug));
      return n;
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Zap className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Hybrid Bulk Generator</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Generate thousands of unique, localized pages at zero AI cost using pre-written variation banks.
            </p>
          </div>
        </div>

        {/* Step 1 — Website */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
              Select Website
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={websiteId} onValueChange={v => { setWebsiteId(v); setSelectedServices(new Set()); setBlueprintId(""); setSelectedClusterIds(new Set()); setClusterSearch(""); setSelectedStateCodes(new Set()); setSelectedCitySlugs(new Set()); setServiceProgress([]); setLastResult(null); }}>
              <SelectTrigger data-testid="select-website" className="w-full max-w-md">
                <SelectValue placeholder="Choose a website..." />
              </SelectTrigger>
              <SelectContent>
                {websites.map((w: any) => (
                  <SelectItem key={w.id} value={w.id} data-testid={`option-website-${w.id}`}>
                    {w.settings?.parentDomain ? `${w.settings.parentDomain}${w.settings.proxyPath || ''}` : w.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Step 2 — Blueprint */}
        {websiteId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                Blueprint
              </CardTitle>
            </CardHeader>
            <CardContent>
              {blueprintsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : blueprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blueprints found for this account.</p>
              ) : (() => {
                const activeBp = blueprints.find((bp: any) => bp.id === blueprintId);
                return (
                  <div className="space-y-3">
                    {activeBp ? (
                      <div className="flex items-center gap-2 p-3 rounded-lg border border-primary bg-primary/5">
                        <FileText className="size-4 text-primary shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{activeBp.name}</p>
                          {activeBp.pageType && <p className="text-xs text-muted-foreground capitalize">{activeBp.pageType.replace(/_/g, " ")}</p>}
                        </div>
                        <CheckCircle2 className="size-4 text-primary shrink-0" />
                      </div>
                    ) : (
                      <p className="text-sm text-amber-600">No blueprint selected — pages will use default title/slug format.</p>
                    )}
                    {blueprints.length > 1 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowBlueprintList(v => !v)}
                          className="text-xs text-primary underline-offset-2 hover:underline"
                          data-testid="button-toggle-blueprint-list"
                        >
                          {showBlueprintList ? "Hide blueprint list" : `Change blueprint (${blueprints.length} available)`}
                        </button>
                        {showBlueprintList && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mt-2">
                            {blueprints.map((bp: any) => (
                              <button
                                key={bp.id}
                                onClick={() => { setBlueprintId(prev => prev === bp.id ? "" : bp.id); setShowBlueprintList(false); }}
                                className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors text-xs ${blueprintId === bp.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                                data-testid={`button-blueprint-${bp.id}`}
                              >
                                <FileText className={`size-3 mt-0.5 shrink-0 ${blueprintId === bp.id ? "text-primary" : "text-muted-foreground"}`} />
                                <span className="truncate font-medium">{bp.name}</span>
                                {blueprintId === bp.id && <CheckCircle2 className="size-3 text-primary ml-auto shrink-0 mt-0.5" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {blueprints.length > 1 && (
                      <div className={`rounded-md border px-3 py-2.5 transition-colors mt-1 ${cycleBlueprints ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                        <label className="flex items-center gap-2.5 cursor-pointer w-fit" data-testid="label-cycle-blueprints">
                          <Checkbox
                            checked={cycleBlueprints}
                            onCheckedChange={v => setCycleBlueprints(!!v)}
                            data-testid="checkbox-cycle-blueprints"
                          />
                          <Repeat2 className={`size-3.5 ${cycleBlueprints ? "text-blue-600" : "text-muted-foreground"}`} />
                          <span className="text-sm font-semibold">Run all {blueprints.length} blueprints in sequence</span>
                        </label>
                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                          {cycleBlueprints
                            ? `Each blueprint creates its own job and the next starts automatically when it finishes. Total pages = ${blueprints.length} blueprints × pages per blueprint.`
                            : "Only the blueprint selected above will run."}
                        </p>
                      </div>
                    )}
                    {!selectedWebsite?.settings?.defaultBlueprintId && !cycleBlueprints && (
                      <p className="text-xs text-muted-foreground">Tip: Set a default blueprint in Website Settings so it's always pre-selected.</p>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Configure Generation */}
        {websiteId && services.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                Configure Generation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Service multi-select */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Services <span className="text-muted-foreground font-normal text-xs">({selectedServices.size} of {services.length} selected)</span></Label>
                  <Button
                    type="button" variant="ghost" size="sm" className="h-7 text-xs"
                    onClick={() => setSelectedServices(selectedServices.size === services.length ? new Set() : new Set(services))}
                    data-testid="button-select-all-services"
                  >
                    {selectedServices.size === services.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                  {services.map(svc => {
                    const hasBank = bankServicesSet.has(svc);
                    return (
                      <label key={svc} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-service-${svc}`}>
                        <Checkbox
                          checked={selectedServices.has(svc)}
                          onCheckedChange={checked => setSelectedServices(prev => {
                            const n = new Set(prev);
                            checked ? n.add(svc) : n.delete(svc);
                            return n;
                          })}
                          data-testid={`checkbox-service-${svc}`}
                        />
                        <span className="text-sm flex-1">{svc}</span>
                        {!hasBank && (
                          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">No banks</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Query Clusters */}
              {clusters.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      Query Clusters{" "}
                      <span className="text-muted-foreground font-normal text-xs">
                        ({selectedClusterIds.size === 0 ? "all clusters" : `${selectedClusterIds.size} of ${clusters.length} selected`})
                      </span>
                    </Label>
                    {selectedClusterIds.size > 0 && (
                      <Button
                        type="button" variant="ghost" size="sm" className="h-7 text-xs"
                        onClick={() => setSelectedClusterIds(new Set())}
                        data-testid="button-clear-clusters"
                      >
                        Clear (use all)
                      </Button>
                    )}
                  </div>
                  <div className="relative max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter clusters..."
                      className="pl-9 h-9"
                      value={clusterSearch}
                      onChange={e => setClusterSearch(e.target.value)}
                      data-testid="input-cluster-search"
                    />
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                    {clusters
                      .filter((c: any) => !clusterSearch || c.name?.toLowerCase().includes(clusterSearch.toLowerCase()) || c.primaryKeyword?.toLowerCase().includes(clusterSearch.toLowerCase()))
                      .map((c: any) => (
                        <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-cluster-${c.id}`}>
                          <Checkbox
                            checked={selectedClusterIds.has(c.id)}
                            onCheckedChange={checked => setSelectedClusterIds(prev => {
                              const n = new Set(prev);
                              checked ? n.add(c.id) : n.delete(c.id);
                              return n;
                            })}
                            data-testid={`checkbox-cluster-${c.id}`}
                          />
                          <span className="text-sm flex-1 truncate">{c.name || c.primaryKeyword}</span>
                          {c.intentType && (
                            <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0 capitalize">{c.intentType}</span>
                          )}
                        </label>
                      ))
                    }
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedClusterIds.size === 0
                      ? "No filter — all account clusters will be used during generation."
                      : `Only the ${selectedClusterIds.size} selected cluster(s) will be used to enrich pages.`}
                  </p>
                </div>
              )}

              {/* Mode */}
              <div className="space-y-1.5">
                <Label>Location scope</Label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    {
                      value: "all_states",
                      label: "All States",
                      count: dbStates.length > 0 ? `${dbStates.length} imported` : "50 pages",
                    },
                    {
                      value: "specific_states",
                      label: "Specific States",
                      count: `${selectedStateCodes.size} selected`,
                    },
                    {
                      value: "specific_cities",
                      label: "Specific Cities",
                      count: `${selectedCitySlugs.size} selected`,
                    },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value as any)}
                      className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${mode === opt.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                      data-testid={`button-mode-${opt.value}`}
                    >
                      {opt.label}
                      <span className={`ml-1.5 text-xs ${mode === opt.value ? "opacity-75" : "text-muted-foreground"}`}>({opt.count})</span>
                    </button>
                  ))}
                </div>
                {mode === "all_states" && dbStates.length > 0 && (
                  <p className="text-xs text-muted-foreground">Will generate one page for each of your {dbStates.length} imported state location{dbStates.length !== 1 ? "s" : ""}.</p>
                )}
              </div>

              {/* Specific States picker from DB */}
              {mode === "specific_states" && (
                <div className="space-y-2">
                  {dbStates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No state locations imported yet. Go to Locations and import states first.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Filter states..." className="pl-9 h-9" value={stateSearch} onChange={e => setStateSearch(e.target.value)} />
                        </div>
                        <Button variant="outline" size="sm" onClick={selectAllStates} data-testid="button-select-all-states">
                          {allStatesSelected ? "Deselect All" : "Select All"}
                        </Button>
                      </div>
                      <ScrollArea className="h-52 border rounded-md p-2">
                        <div className="grid grid-cols-2 gap-1">
                          {filteredStates.map((loc: any, idx: number) => (
                            <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer select-none" data-testid={`label-state-${loc.stateCode}`}
                              onClick={e => handleStateClick(e, idx, loc.stateCode)}>
                              <Checkbox
                                checked={selectedStateCodes.has(loc.stateCode)}
                                data-testid={`checkbox-state-${loc.stateCode}`}
                              />
                              <span className="text-sm font-medium">{loc.name}</span>
                              <span className="text-xs text-muted-foreground ml-auto">{loc.stateCode}</span>
                            </label>
                          ))}
                        </div>
                      </ScrollArea>
                      <p className="text-xs text-muted-foreground">{selectedStateCodes.size} of {dbStates.length} states selected</p>
                    </>
                  )}
                </div>
              )}

              {/* Specific Cities picker from DB */}
              {mode === "specific_cities" && (
                <div className="space-y-2">
                  {dbCities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No city locations imported yet. Go to Locations and import cities first.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Filter cities..." className="pl-9 h-9" value={citySearch} onChange={e => setCitySearch(e.target.value)} />
                        </div>
                        <Button variant="outline" size="sm" onClick={selectAllCities} data-testid="button-select-all-cities">
                          {allCitiesSelected ? "Deselect All" : "Select All"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={clearAllCities} data-testid="button-clear-all-cities" disabled={selectedCitySlugs.size === 0}>
                          Clear All
                        </Button>
                      </div>

                      {/* Top Cities quick select + Tier filters */}
                      <div className="flex items-center gap-2 flex-wrap" data-testid="div-top-cities-controls">
                        <Select
                          value={topCitiesLimit === null ? "" : String(topCitiesLimit)}
                          onValueChange={applyTopCities}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-top-cities">
                            <SelectValue placeholder="Quick select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {[20, 50, 100, 250, 500, 750, 1000, 2500, 5000].map(n => (
                              <SelectItem key={n} value={String(n)}>Top {n.toLocaleString()}</SelectItem>
                            ))}
                            <SelectItem value="all">All Cities</SelectItem>
                          </SelectContent>
                        </Select>
                        {([
                          { tier: 1, label: "Tier 1 (500K+)" },
                          { tier: 2, label: "Tier 2 (100K–500K)" },
                          { tier: 3, label: "Tier 3 (<100K)" },
                        ] as { tier: number; label: string }[]).map(({ tier, label }) => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => applyTierFilter(tier)}
                            data-testid={`button-tier-${tier}`}
                            className={`h-8 px-3 rounded-md border text-xs font-medium transition-colors ${
                              cityTierFilter === tier
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Alphabet bar */}
                      <div className="overflow-x-auto">
                        <div className="flex gap-0.5 min-w-max pb-0.5" data-testid="div-alphabet-bar">
                          {ALPHABET.map(letter => {
                            const avail = cityAvailableLetters.has(letter);
                            const fully = avail && isCityLetterFullySelected(letter);
                            const partial = avail && isCityLetterPartial(letter);
                            return (
                              <button
                                key={letter}
                                type="button"
                                disabled={!avail}
                                onClick={() => toggleCityLetter(letter)}
                                data-testid={`button-letter-${letter}`}
                                className={`w-7 h-7 rounded text-xs font-mono font-semibold transition-colors ${
                                  fully   ? "bg-primary text-primary-foreground" :
                                  partial ? "bg-primary/25 text-primary border border-primary/40" :
                                  avail   ? "bg-muted hover:bg-muted-foreground/20 text-foreground" :
                                            "text-muted-foreground/25 cursor-not-allowed"
                                }`}
                              >
                                {letter}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Counter */}
                      <p className="text-sm font-medium" data-testid="text-city-selected-count">
                        {selectedCitySlugs.size.toLocaleString()} {selectedCitySlugs.size === 1 ? "city" : "cities"} selected
                        <span className="text-muted-foreground font-normal"> of {dbCities.length.toLocaleString()} &nbsp;·&nbsp; Shift-click to select a range</span>
                      </p>

                      {/* City list — grouped when not searching/filtering, flat when searching or filter active */}
                      <ScrollArea className="h-64 border rounded-md p-2">
                        {citySearch || topCitiesLimit !== null || cityTierFilter !== null ? (
                          <div className="space-y-0.5">
                            {filteredCities.map((loc: any, idx: number) => (
                              <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer select-none" data-testid={`label-city-${loc.slug}`}
                                onClick={e => handleCityClick(e, idx, loc.slug)}>
                                <Checkbox checked={selectedCitySlugs.has(loc.slug)} data-testid={`checkbox-city-${loc.slug}`} />
                                <span className="text-sm font-medium">{loc.name}</span>
                                <span className="text-xs text-muted-foreground">{loc.stateCode}</span>
                                {loc.population > 0 && <span className="text-xs text-muted-foreground ml-auto">{loc.population?.toLocaleString()}</span>}
                              </label>
                            ))}
                            {filteredCities.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No cities match.</p>}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(cityGroups)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([letter, group]) => (
                                <div key={letter}>
                                  <div className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm px-2 py-0.5 text-xs font-bold text-muted-foreground tracking-widest rounded mb-0.5" data-testid={`header-letter-${letter}`}>
                                    {letter}
                                  </div>
                                  {(group as any[]).map((loc: any) => {
                                    const idx = cityIndexMap.get(loc.slug) ?? 0;
                                    return (
                                      <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer select-none" data-testid={`label-city-${loc.slug}`}
                                        onClick={e => handleCityClick(e, idx, loc.slug)}>
                                        <Checkbox checked={selectedCitySlugs.has(loc.slug)} data-testid={`checkbox-city-${loc.slug}`} />
                                        <span className="text-sm font-medium">{loc.name}</span>
                                        <span className="text-xs text-muted-foreground">{loc.stateCode}</span>
                                        {loc.population > 0 && <span className="text-xs text-muted-foreground ml-auto">{loc.population?.toLocaleString()}</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                              ))}
                          </div>
                        )}
                      </ScrollArea>
                    </>
                  )}
                </div>
              )}

              {/* Both locations toggle */}
              <div className="pt-1 border-t">
                <div className={`rounded-md border px-3 py-2.5 transition-colors ${runBothLocations ? "border-purple-300 bg-purple-50" : "border-slate-200 bg-slate-50"}`}>
                  <label className="flex items-center gap-2.5 cursor-pointer w-fit" data-testid="label-run-both-locations">
                    <Checkbox
                      checked={runBothLocations}
                      onCheckedChange={v => setRunBothLocations(!!v)}
                      data-testid="checkbox-run-both-locations"
                    />
                    <Repeat2 className={`size-3.5 ${runBothLocations ? "text-purple-600" : "text-muted-foreground"}`} />
                    <span className="text-sm font-semibold">Generate both state pages AND city pages</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {runBothLocations
                      ? `Runs all ${cycleBlueprints && blueprints.length > 1 ? blueprints.length : 1} blueprint(s) × 50 states first, then the same blueprint(s) × all selected cities — fully automatic.`
                      : "Currently only generating the location type selected above. Enable this to also generate the other location type automatically."}
                  </p>
                </div>
              </div>

              {/* Options */}
              <div className="pt-1 border-t">
                <div className={`rounded-md border px-3 py-2.5 transition-colors ${overwrite ? "border-blue-300 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
                  <label className="flex items-center gap-2.5 cursor-pointer w-fit" data-testid="label-overwrite">
                    <Checkbox
                      checked={overwrite}
                      onCheckedChange={v => setOverwrite(!!v)}
                      data-testid="checkbox-overwrite"
                    />
                    <span className="text-sm font-semibold">Overwrite existing pages</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {overwrite
                      ? "Overwrite ON — pages that already exist will be regenerated with fresh content from the variation bank."
                      : "⚠ Overwrite OFF — pages with a slug that already exists will be skipped. If you are re-running generation on a site that already has pages, check this box or all pages will be skipped."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4 — Generate */}
        {websiteId && selectedServices.size > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                Generate Pages
              </CardTitle>
              <CardDescription>
                {(() => {
                  const bpCount = cycleBlueprints && blueprints.length > 1 ? blueprints.length : 1;
                  const stateCount = new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)).size || 50;
                  const statePagesPerBp = selectedServices.size * clusterCountForEstimate * stateCount;
                  const cityPagesPerBp = estimatedPages;
                  const totalEst = runBothLocations
                    ? (statePagesPerBp + cityPagesPerBp) * bpCount
                    : estimatedPages * bpCount;
                  return (
                    <>
                      Will {overwrite ? "create or update" : "create up to"} <strong>{totalEst.toLocaleString()}</strong> pages
                      {runBothLocations
                        ? <> across <strong>{bpCount * 2} jobs</strong> ({bpCount} blueprint{bpCount !== 1 ? "s" : ""} × {stateCount} states + {bpCount} blueprint{bpCount !== 1 ? "s" : ""} × {effectiveTargetCount.toLocaleString()} cities)</>
                        : bpCount > 1
                          ? <> across <strong>{bpCount} blueprints</strong> ({estimatedPages.toLocaleString()} per blueprint: {selectedServices.size} service{selectedServices.size !== 1 ? "s" : ""} × {clusterCountForEstimate} cluster{clusterCountForEstimate !== 1 ? "s" : ""} × {effectiveTargetCount.toLocaleString()} location{effectiveTargetCount !== 1 ? "s" : ""})</>
                          : <> ({selectedServices.size} service{selectedServices.size !== 1 ? "s" : ""} × {clusterCountForEstimate} cluster{clusterCountForEstimate !== 1 ? "s" : ""} × {effectiveTargetCount.toLocaleString()} location{effectiveTargetCount !== 1 ? "s" : ""})</>
                      } — zero AI calls, instant.
                      {overwrite && <span className="text-blue-600 font-medium"> Overwrite mode on — existing pages will be regenerated.</span>}
                      {blueprintDedupesCities && (
                        <span className="block mt-1.5 text-amber-700 font-medium">
                          ⚠ This blueprint uses a state-level slug (no {"{location}"} placeholder). Your {targetCount.toLocaleString()} selected cities cover {uniqueStateCountFromCities} unique states — the generator will create {uniqueStateCountFromCities} state pages per service/cluster, not city pages. To generate city-level pages, select a blueprint whose slug contains {"{location}"} or {"{city}"}.
                        </span>
                      )}
                    </>
                  );
                })()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="flex flex-col gap-2">
                <div className="flex gap-3">
                  <Button
                    size="lg"
                    onClick={runAllServices}
                    disabled={isRunningAll || targetCount === 0}
                    data-testid="button-generate"
                    className="gap-2"
                  >
                    {(() => {
                      if (isRunningAll) return <><Loader2 className="size-4 animate-spin" /> Running in background...</>;
                      const bpCount = cycleBlueprints && blueprints.length > 1 ? blueprints.length : 1;
                      const stateCount = new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)).size || 50;
                      const totalEst = runBothLocations
                        ? (selectedServices.size * clusterCountForEstimate * stateCount + estimatedPages) * bpCount
                        : estimatedPages * bpCount;
                      const suffix = runBothLocations
                        ? ` (${bpCount * 2} jobs: states + cities)`
                        : bpCount > 1 ? ` (${bpCount} blueprints)` : "";
                      return <><Play className="size-4" /> Generate {totalEst.toLocaleString()} Pages{suffix}</>;
                    })()}
                  </Button>
                </div>
                {isRunningAll && activeJobId && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    {bpQueueDisplay.total > 1
                      ? `Job ${bpQueueDisplay.idx + 1} of ${bpQueueDisplay.total}: ${bpQueueDisplay.label} — next starts automatically.`
                      : "Running on server — you can close this tab or switch apps and come back later. Progress updates every 2 s."}
                  </p>
                )}
                {isRunningAll && bpQueueDisplay.total > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {bpQueueRef.current.map((item, i) => (
                      <span key={`${item.bpId}-${i}`} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                        i < bpQueueDisplay.idx ? "bg-green-50 border-green-200 text-green-700" :
                        i === bpQueueDisplay.idx ? "bg-primary/10 border-primary text-primary font-medium" :
                        "bg-muted border-border text-muted-foreground"
                      }`}>
                        {i < bpQueueDisplay.idx && <CheckCircle2 className="size-3" />}
                        {i === bpQueueDisplay.idx && <Loader2 className="size-3 animate-spin" />}
                        {i > bpQueueDisplay.idx && <span className="size-3 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>}
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Per-service progress */}
              {serviceProgress.length > 0 && (
                <div className="space-y-1.5">
                  {serviceProgress.map(p => (
                    <div key={p.service} className="flex items-center gap-3 text-sm py-1.5 px-3 rounded-md border bg-background" data-testid={`row-progress-${p.service}`}>
                      <div className="shrink-0">
                        {p.status === "pending" && <div className="size-4 rounded-full border-2 border-muted-foreground/30" />}
                        {p.status === "running" && <Loader2 className="size-4 animate-spin text-primary" />}
                        {p.status === "done" && <CheckCircle2 className="size-4 text-green-600" />}
                        {p.status === "error" && <XCircle className="size-4 text-red-500" />}
                        {p.status === "no-bank" && <AlertCircle className="size-4 text-amber-500" />}
                      </div>
                      <span className={`flex-1 font-medium ${p.status === "pending" ? "text-muted-foreground" : ""}`}>{p.service}</span>
                      {p.status === "done" && (
                        <span className="text-xs flex items-center gap-1.5">
                          {(p.created + p.updated) > 0
                            ? <span className="text-green-700 font-semibold">{p.created + p.updated} pages</span>
                            : p.skipped > 0
                              ? <span className="text-muted-foreground">{p.skipped} skipped</span>
                              : <span className="text-muted-foreground">0 pages</span>
                          }
                          {p.skipped > 0 && (p.created + p.updated) > 0 && <span className="text-muted-foreground">· {p.skipped} skipped</span>}
                          {p.errors > 0 && <span className="text-red-500">· {p.errors} errors</span>}
                        </span>
                      )}
                      {p.status === "running" && <span className="text-xs text-primary">Generating...</span>}
                      {p.status === "no-bank" && <span className="text-xs text-amber-600">Write banks first</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Summary */}
              {lastResult && !isRunningAll && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-1" data-testid="div-results">
                  <p className="font-medium text-sm">Run complete</p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-green-700 font-semibold" data-testid="text-created">✓ {lastResult.created} pages generated</span>
                    {lastResult.skipped > 0 && <span className="text-muted-foreground" data-testid="text-skipped">⊘ {lastResult.skipped} skipped</span>}
                    {lastResult.errors > 0 && <span className="text-red-600" data-testid="text-errors">✗ {lastResult.errors} errors</span>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
