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
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Play, XCircle, Zap } from "lucide-react";
import { api } from "@/lib/api";

type QueueItem = { bpId: string; locPayload: Record<string, any>; label: string };
type ProgressRow = { service: string; status: string; created: number; updated: number; skipped: number; errors: number };
type CityLimit = "100" | "500" | "1000" | "5000" | "all";
type QueryCluster = { id: string; serviceId?: string | null; name: string; intentType: string; primaryKeyword: string; secondaryKeywords?: string[] };
type ClusterMode = "none" | "selected" | "all";

// ✅ CHANGED: brand + CTA + demo banner state shape
type BrandOverride = {
  websiteUrl: string;
  phoneOverride: string;
  ctaHeading: string;
  ctaBody: string;
  ctaButtonLabel: string;
};
type DemoBanner = {
  url: string;
  heading: string;
  subtext: string;
  buttonLabel: string;
};

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

function byPopulationThenName(a: any, b: any) {
  const ap = Number(a.population || 0);
  const bp = Number(b.population || 0);
  if (bp !== ap) return bp - ap;
  return String(a.name).localeCompare(String(b.name)) || String(a.stateCode).localeCompare(String(b.stateCode));
}

function cityPayload(cities: any[]) {
  return {
    mode: "specific_cities",
    cities: cities.map((loc: any) => ({ name: loc.name, stateAbbr: loc.stateCode })).filter((c: any) => c.name && c.stateAbbr),
  };
}

export default function BulkGeneratorPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [websiteId, setWebsiteId] = useState(() => new URLSearchParams(window.location.search).get("websiteId") || "");
  const [blueprintId, setBlueprintId] = useState("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityLimit, setCityLimit] = useState<CityLimit>("100");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [clusterMode, setClusterMode] = useState<ClusterMode>("none");
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(new Set());
  const [clusterSearch, setClusterSearch] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [cycleBlueprints, setCycleBlueprints] = useState(false);
  const [runBothLocations, setRunBothLocations] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [serviceProgress, setServiceProgress] = useState<ProgressRow[]>([]);
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[]; warning?: string } | null>(null);
  const [lastFailure, setLastFailure] = useState("");
  const [bpQueueDisplay, setBpQueueDisplay] = useState({ idx: 0, total: 1, label: "" });

  // ✅ CHANGED: brand override state
  const [brandOverride, setBrandOverride] = useState<BrandOverride>({
    websiteUrl: "",
    phoneOverride: "",
    ctaHeading: "",
    ctaBody: "",
    ctaButtonLabel: "",
  });

  // ✅ CHANGED: demo banner state
  const [demoBanner, setDemoBanner] = useState<DemoBanner>({
    url: "",
    heading: "",
    subtext: "",
    buttonLabel: "",
  });

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
  const queryClustersQ = useQuery<QueryCluster[]>({ queryKey: ["/api/accounts", accountId, "query-clusters"], queryFn: () => api.get<QueryCluster[]>(`/api/accounts/${accountId}/query-clusters`), enabled: !!accountId });

  const activeJobQ = useQuery<any>({
    queryKey: ["/api/jobs/active", activeJobId],
    queryFn: () => api.get<any>(`/api/jobs/${activeJobId}`),
    enabled: !!activeJobId,
    refetchInterval: (query) => isTerminalStatus(query.state.data?.status) ? false : 2000,
    staleTime: 0,
  });

  const services = servicesQ.data ?? [];
  const bankedServices = bankServicesQ.data ?? [];
  const bankServicesSet = new Set(bankedServices);
  const allLocations = locationsQ.data ?? [];
  const blueprints = blueprintsQ.data ?? [];
  const queryClusters = queryClustersQ.data ?? [];
  const selectedBlueprint = blueprints.find((bp: any) => bp.id === blueprintId);

  const dbStates = useMemo(() => {
    const seen = new Set<string>();
    return allLocations
      .filter((l: any) => l.type === "state" && l.stateCode && !seen.has(l.stateCode) && (seen.add(l.stateCode), true))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  }, [allLocations]);

  const dbCities = useMemo(() => {
    const seen = new Set<string>();
    return allLocations
      .filter((l: any) => l.type === "city" && l.slug && !seen.has(l.slug) && (seen.add(l.slug), true))
      .sort(byPopulationThenName);
  }, [allLocations]);

  const filteredStates = useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    return dbStates.filter((loc: any) => !q || String(loc.name).toLowerCase().includes(q) || String(loc.stateCode || "").toLowerCase().includes(q));
  }, [dbStates, stateSearch]);

  const filteredCitiesAll = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return dbCities.filter((loc: any) => !q || String(loc.name).toLowerCase().includes(q) || String(loc.stateCode || "").toLowerCase().includes(q));
  }, [dbCities, citySearch]);

  const filteredCities = useMemo(() => {
    if (cityLimit === "all") return filteredCitiesAll;
    return filteredCitiesAll.slice(0, Number(cityLimit));
  }, [filteredCitiesAll, cityLimit]);

  const expandedStateCities = useMemo(() => {
    if (!runBothLocations) return [];
    const selectedStates = new Set(Array.from(selectedStateCodes).map((s) => s.toUpperCase()));
    const selectedCities = new Set(selectedCitySlugs);
    return dbCities.filter((city: any) => {
      if (selectedCities.has(city.slug)) return true;
      const stateCode = String(city.stateCode || "").toUpperCase();
      if (selectedStates.size > 0) return selectedStates.has(stateCode);
      if (mode === "all_states") return true;
      return false;
    });
  }, [dbCities, mode, runBothLocations, selectedCitySlugs, selectedStateCodes]);

  const filteredClusters = useMemo(() => {
    const q = clusterSearch.trim().toLowerCase();
    return queryClusters.filter((cluster) => {
      if (!q) return true;
      return [cluster.name, cluster.intentType, cluster.primaryKeyword, ...(cluster.secondaryKeywords || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [queryClusters, clusterSearch]);

  useEffect(() => {
    const defaultId = selectedWebsite?.settings?.defaultBlueprintId;
    if (defaultId) setBlueprintId(defaultId);
    else if (!blueprintId && blueprints.length > 0) setBlueprintId(blueprints[0].id);
  }, [selectedWebsite?.id, blueprints.length]);

  useEffect(() => {
    if (clusterMode !== "selected") return;
    setSelectedClusterIds((prev) => new Set(Array.from(prev).filter((id) => queryClusters.some((cluster) => cluster.id === id))));
  }, [queryClusters, clusterMode]);

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
    setStateSearch("");
    setCitySearch("");
    setCityLimit("100");
    setClusterMode("none");
    setSelectedClusterIds(new Set());
    setClusterSearch("");
    setServiceProgress([]);
    setLastResult(null);
    setLastFailure("");
    setActiveJobId("");
    setIsRunningAll(false);
    setCycleBlueprints(false);
    bpQueueRef.current = [];
    bpQueueIdxRef.current = 0;
    handledTerminalJobRef.current = "";
  }

  function buildStatePayload() {
    const selectedStates = Array.from(selectedStateCodes);
    if (selectedStates.length > 0) return { mode: "specific_states", states: selectedStates };
    const states = Array.from(new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)));
    return states.length ? { mode: "specific_states", states } : { mode: "all_states" };
  }

  function buildCityPayload() {
    const source = Array.from(selectedCitySlugs).map((slug) => dbCities.find((l: any) => l.slug === slug)).filter(Boolean);
    return cityPayload(source);
  }

  function buildExpandedCityPayload() {
    return cityPayload(expandedStateCities);
  }

  function buildLocationPayload() {
    if (mode === "all_states") return buildStatePayload();
    if (mode === "specific_states") return { mode: "specific_states", states: Array.from(selectedStateCodes) };
    return buildCityPayload();
  }

  function toggleService(service: string, checked: boolean) {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      checked ? next.add(service) : next.delete(service);
      return next;
    });
  }

  function toggleCluster(clusterId: string, checked: boolean) {
    setSelectedClusterIds((prev) => {
      const next = new Set(prev);
      checked ? next.add(clusterId) : next.delete(clusterId);
      return next;
    });
  }

  function selectAllServices() { setSelectedServices(new Set(services)); }
  function selectBankedServices() { setSelectedServices(new Set(services.filter(s => bankServicesSet.has(s)))); }
  function clearServices() { setSelectedServices(new Set()); }
  function selectVisibleStates() { setSelectedStateCodes(new Set(filteredStates.map((loc: any) => loc.stateCode).filter(Boolean))); }
  function clearStates() { setSelectedStateCodes(new Set()); }
  function selectVisibleCities() { setSelectedCitySlugs(new Set(filteredCities.map((loc: any) => loc.slug).filter(Boolean))); }
  function clearCities() { setSelectedCitySlugs(new Set()); }
  function selectVisibleClusters() { setSelectedClusterIds(new Set(filteredClusters.map((cluster) => cluster.id))); }
  function clearClusters() { setSelectedClusterIds(new Set()); }

  function selectedQueryClusterIds() {
    if (clusterMode === "all") return queryClusters.map((cluster) => cluster.id);
    if (clusterMode === "selected") return Array.from(selectedClusterIds);
    return [];
  }

  // ✅ CHANGED: brand override helper
  function setBrand(field: keyof BrandOverride, value: string) {
    setBrandOverride((prev) => ({ ...prev, [field]: value }));
  }

  // ✅ CHANGED: demo banner helper
  function setDemo(field: keyof DemoBanner, value: string) {
    setDemoBanner((prev) => ({ ...prev, [field]: value }));
  }

  async function submitJobForBlueprint(item: QueueItem) {
    try {
      const queryClusterIds = selectedQueryClusterIds();

      // ✅ CHANGED: include brand and demo banner in every job payload
      const brandPayload: Record<string, string> = {};
      if (brandOverride.websiteUrl.trim())    brandPayload.websiteUrl    = brandOverride.websiteUrl.trim();
      if (brandOverride.phoneOverride.trim()) brandPayload.phoneOverride = brandOverride.phoneOverride.trim();
      if (brandOverride.ctaHeading.trim())    brandPayload.ctaHeading    = brandOverride.ctaHeading.trim();
      if (brandOverride.ctaBody.trim())       brandPayload.ctaBody       = brandOverride.ctaBody.trim();
      if (brandOverride.ctaButtonLabel.trim()) brandPayload.ctaButtonLabel = brandOverride.ctaButtonLabel.trim();

      const demoBannerPayload: Record<string, string> | null = demoBanner.url.trim()
        ? {
            url:         demoBanner.url.trim(),
            heading:     demoBanner.heading.trim(),
            subtext:     demoBanner.subtext.trim(),
            buttonLabel: demoBanner.buttonLabel.trim(),
          }
        : null; // null = hide banner (leave URL blank to hide)

      const payload: Record<string, any> = {
        services: Array.from(selectedServices),
        ...item.locPayload,
        overwrite,
        // ✅ CHANGED: new fields forwarded to the server
        ...(Object.keys(brandPayload).length > 0 ? { brandOverride: brandPayload } : {}),
        ...(demoBannerPayload ? { demoBanner: demoBannerPayload } : {}),
      };
      if (item.bpId) payload.blueprintId = item.bpId;
      if (queryClusterIds.length > 0) payload.queryClusterIds = queryClusterIds;

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
    if (clusterMode === "selected" && selectedClusterIds.size === 0) {
      toast({ title: "Choose query clusters", description: "Select at least one query cluster or switch cluster mode to none.", variant: "destructive" });
      return;
    }
    if (clusterMode === "all" && queryClusters.length === 0) {
      toast({ title: "No query clusters found", description: "Create query clusters first or switch cluster mode to none.", variant: "destructive" });
      return;
    }

    const bpIds = cycleBlueprints && blueprints.length > 1 ? blueprints.map((bp: any) => bp.id) : [blueprintId].filter(Boolean);
    if (bpIds.length === 0) {
      toast({ title: "Choose a blueprint", description: "Select a blueprint before generating pages.", variant: "destructive" });
      return;
    }

    const queue: QueueItem[] = [];
    if (runBothLocations) {
      const hasStateSelection = selectedStateCodes.size > 0 || mode === "all_states";
      const hasCitySelection = expandedStateCities.length > 0;
      if (!hasStateSelection && !hasCitySelection) {
        toast({ title: "Choose locations", description: "Select at least one state or city before running both location types.", variant: "destructive" });
        return;
      }
      for (const id of bpIds) {
        const bpIndex = bpIds.indexOf(id) + 1;
        if (hasStateSelection) queue.push({ bpId: id, locPayload: buildStatePayload(), label: `State pages ${bpIndex}/${bpIds.length}` });
        if (hasCitySelection) queue.push({ bpId: id, locPayload: buildExpandedCityPayload(), label: `City pages ${bpIndex}/${bpIds.length}` });
      }
    } else {
      queue.push(...bpIds.map((id, i) => ({ bpId: id, locPayload: buildLocationPayload(), label: `Blueprint ${i + 1}/${bpIds.length}` })));
    }

    if (queue.length === 0) return;
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

  const stateTargetCount = selectedStateCodes.size > 0 ? selectedStateCodes.size : mode === "all_states" ? (dbStates.length || 50) : 0;
  const cityTargetCount = runBothLocations ? expandedStateCities.length : selectedCitySlugs.size;
  const singleModeTargetCount = mode === "all_states" ? (dbStates.length || 50) : mode === "specific_states" ? selectedStateCodes.size : selectedCitySlugs.size;
  const effectiveTargetCount = runBothLocations ? stateTargetCount + cityTargetCount : singleModeTargetCount;
  const blueprintMultiplier = cycleBlueprints && blueprints.length > 1 ? blueprints.length : 1;
  const clusterMultiplier = clusterMode === "all" ? Math.max(queryClusters.length, 0) : clusterMode === "selected" ? selectedClusterIds.size : 1;
  const estimatedPages = selectedServices.size * effectiveTargetCount * blueprintMultiplier * Math.max(clusterMultiplier, 1);
  const baseEstimatedPages = selectedServices.size * effectiveTargetCount * blueprintMultiplier;
  const showStatePicker = runBothLocations || mode === "specific_states";
  const showCityPicker = runBothLocations || mode === "specific_cities";
  const isClusterReady = clusterMode === "none" || (clusterMode === "all" && queryClusters.length > 0) || (clusterMode === "selected" && selectedClusterIds.size > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><Zap className="size-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">Hybrid Bulk Generator</h1>
            <p className="text-muted-foreground text-sm">Generate pages from service banks with optional query-cluster intent expansion.</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Select Website</CardTitle></CardHeader>
          <CardContent>
            <Select value={websiteId} onValueChange={resetForWebsite}>
              <SelectTrigger className="max-w-md"><SelectValue placeholder="Choose a website..." /></SelectTrigger>
              <SelectContent>{websites.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain ? `${w.settings.parentDomain}${w.settings.proxyPath || ""}` : w.domain}</SelectItem>)}</SelectContent>
            </Select>
          </CardContent>
        </Card>

        {websiteId && <Card>
          <CardHeader><CardTitle>Blueprint</CardTitle><CardDescription>Choose one blueprint or run every blueprint in sequence.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Select value={blueprintId} onValueChange={setBlueprintId} disabled={cycleBlueprints}>
              <SelectTrigger className="max-w-xl"><SelectValue placeholder="Select blueprint" /></SelectTrigger>
              <SelectContent>{blueprints.map((bp: any) => <SelectItem key={bp.id} value={bp.id}>{bp.name} · {bp.pageType}</SelectItem>)}</SelectContent>
            </Select>
            {selectedBlueprint && !cycleBlueprints && <p className="text-xs text-muted-foreground">Selected: {selectedBlueprint.name}</p>}
            {blueprints.length > 1 && <label className="flex gap-2 items-center text-sm"><Checkbox checked={cycleBlueprints} onCheckedChange={(v) => setCycleBlueprints(!!v)} />Run all {blueprints.length} blueprints</label>}
          </CardContent>
        </Card>}

        {/* ✅ CHANGED: Brand & Contact overrides card — new section */}
        {websiteId && <Card>
          <CardHeader>
            <CardTitle>Brand &amp; Contact</CardTitle>
            <CardDescription>Override brand values on every generated page. Leave blank to use account defaults.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="websiteUrl">Main Website URL</Label>
              <Input
                id="websiteUrl"
                placeholder="https://yoursite.com"
                value={brandOverride.websiteUrl}
                onChange={(e) => setBrand("websiteUrl", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Header brand link &amp; footer</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="phoneOverride">Phone Number</Label>
              <Input
                id="phoneOverride"
                placeholder="(800) 555-0100"
                value={brandOverride.phoneOverride}
                onChange={(e) => setBrand("phoneOverride", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Overrides brand profile phone</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctaHeading">CTA Section Heading</Label>
              <Input
                id="ctaHeading"
                placeholder="Ready to Get Started?"
                value={brandOverride.ctaHeading}
                onChange={(e) => setBrand("ctaHeading", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctaButtonLabel">CTA Button Label</Label>
              <Input
                id="ctaButtonLabel"
                placeholder="Get a Free Quote"
                value={brandOverride.ctaButtonLabel}
                onChange={(e) => setBrand("ctaButtonLabel", e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ctaBody">CTA Body Text</Label>
              <Textarea
                id="ctaBody"
                placeholder="Contact us today to learn how we can help your business."
                value={brandOverride.ctaBody}
                onChange={(e) => setBrand("ctaBody", e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>}

        {/* ✅ CHANGED: Demo Banner card — new section */}
        {websiteId && <Card>
          <CardHeader>
            <CardTitle>Demo Banner</CardTitle>
            <CardDescription>Appears at the top of every generated page. Leave URL blank to hide the banner.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="demoBannerUrl">Demo URL</Label>
              <Input
                id="demoBannerUrl"
                placeholder="https://demo.yoursite.com  (leave blank to hide banner)"
                value={demoBanner.url}
                onChange={(e) => setDemo("url", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="demoBannerHeading">Heading</Label>
              <Input
                id="demoBannerHeading"
                placeholder="See It In Action"
                value={demoBanner.heading}
                onChange={(e) => setDemo("heading", e.target.value)}
                disabled={!demoBanner.url.trim()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="demoBannerButton">Button Label</Label>
              <Input
                id="demoBannerButton"
                placeholder="View Demo"
                value={demoBanner.buttonLabel}
                onChange={(e) => setDemo("buttonLabel", e.target.value)}
                disabled={!demoBanner.url.trim()}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="demoBannerSubtext">Subtext</Label>
              <Input
                id="demoBannerSubtext"
                placeholder="No commitment required."
                value={demoBanner.subtext}
                onChange={(e) => setDemo("subtext", e.target.value)}
                disabled={!demoBanner.url.trim()}
              />
            </div>
          </CardContent>
        </Card>}

        {websiteId && <Card>
          <CardHeader>
            <CardTitle>Configure</CardTitle>
            <CardDescription>{estimatedPages.toLocaleString()} estimated page(s){clusterMode !== "none" ? ` · base ${baseEstimatedPages.toLocaleString()} x ${clusterMultiplier.toLocaleString()} cluster intent(s)` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Label>Services ({selectedServices.size} selected / {services.length} total)</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button type="button" size="sm" variant="outline" onClick={selectAllServices}>Select all</Button>
                  <Button type="button" size="sm" variant="outline" onClick={selectBankedServices}>Select banked only ({bankedServices.length})</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={clearServices}>Clear</Button>
                </div>
              </div>
              <div className="border rounded-md p-2 max-h-64 overflow-y-auto grid md:grid-cols-2 gap-x-4">
                {services.map((service) => <label key={service} className="flex gap-2 items-center py-1 text-sm"><Checkbox checked={selectedServices.has(service)} onCheckedChange={(checked) => toggleService(service, !!checked)} />{service}{!bankServicesSet.has(service) && <span className="text-xs text-amber-600">No banks</span>}</label>)}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Query cluster mode</Label>
              <Select value={clusterMode} onValueChange={(v: ClusterMode) => setClusterMode(v)}>
                <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No cluster expansion</SelectItem>
                  <SelectItem value="selected">Use selected clusters</SelectItem>
                  <SelectItem value="all">Use all clusters ({queryClusters.length})</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Clusters create one additional intent page per selected service/location/blueprint combination. Use this only for high-value intent coverage.</p>
            </div>

            {clusterMode === "selected" && <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Label>Query clusters ({selectedClusterIds.size} selected / {filteredClusters.length.toLocaleString()} visible / {queryClusters.length.toLocaleString()} total)</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={selectVisibleClusters}>Select visible</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={clearClusters}>Clear</Button>
                </div>
              </div>
              <Input placeholder="Search clusters, e.g. high-risk, analytics, healthcare" value={clusterSearch} onChange={(e) => setClusterSearch(e.target.value)} className="max-w-md" />
              <div className="border rounded-md p-2 max-h-64 overflow-y-auto grid md:grid-cols-2 gap-x-4">
                {filteredClusters.map((cluster) => (
                  <label key={cluster.id} className="flex gap-2 items-start py-1 text-sm">
                    <Checkbox checked={selectedClusterIds.has(cluster.id)} onCheckedChange={(checked) => toggleCluster(cluster.id, !!checked)} />
                    <span>
                      <span className="font-medium">{cluster.name}</span>
                      <span className="block text-xs text-muted-foreground">{cluster.intentType} · {cluster.primaryKeyword}</span>
                    </span>
                  </label>
                ))}
                {filteredClusters.length === 0 && <p className="text-sm text-muted-foreground">No query clusters found for this account.</p>}
              </div>
            </div>}

            <div className="space-y-2">
              <Label>Location scope</Label>
              <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all_states">All states</SelectItem><SelectItem value="specific_states">Specific states</SelectItem><SelectItem value="specific_cities">Specific cities</SelectItem></SelectContent>
              </Select>
            </div>

            <label className="flex gap-2 items-center text-sm rounded border px-3 py-2 w-fit"><Checkbox checked={runBothLocations} onCheckedChange={(v) => setRunBothLocations(!!v)} />Generate both state and city pages in one sequence</label>
            {runBothLocations && <p className="text-xs text-muted-foreground">Selected state(s) now automatically include every imported city in those state(s). City picker selections are added on top.</p>}

            {showStatePicker && <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap"><Label>State pages ({selectedStateCodes.size} selected)</Label><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={selectVisibleStates}>Select visible</Button><Button type="button" size="sm" variant="ghost" onClick={clearStates}>Clear</Button></div></div>
              <Input placeholder="Search states, e.g. Utah" value={stateSearch} onChange={(e) => setStateSearch(e.target.value)} className="max-w-sm" />
              <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto border rounded p-2">{filteredStates.map((loc: any) => <label key={loc.slug || loc.stateCode} className="flex gap-2 text-sm"><Checkbox checked={selectedStateCodes.has(loc.stateCode)} onCheckedChange={(checked) => setSelectedStateCodes((prev) => { const next = new Set(prev); checked ? next.add(loc.stateCode) : next.delete(loc.stateCode); return next; })} />{loc.name} <span className="text-xs text-muted-foreground">{loc.stateCode}</span></label>)}</div>
            </div>}

            {showCityPicker && <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap"><Label>City pages ({selectedCitySlugs.size} manually selected / {runBothLocations ? expandedStateCities.length.toLocaleString() : filteredCities.length.toLocaleString()} queued / {filteredCitiesAll.length.toLocaleString()} matched)</Label><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={selectVisibleCities}>Select visible</Button><Button type="button" size="sm" variant="ghost" onClick={clearCities}>Clear</Button></div></div>
              <div className="flex gap-2 flex-wrap"><Input placeholder="Search cities, e.g. St George" value={citySearch} onChange={(e) => setCitySearch(e.target.value)} className="max-w-sm" /><Select value={cityLimit} onValueChange={(v: CityLimit) => setCityLimit(v)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="100">Top 100 cities</SelectItem><SelectItem value="500">Top 500 cities</SelectItem><SelectItem value="1000">Top 1,000 cities</SelectItem><SelectItem value="5000">Top 5,000 cities</SelectItem><SelectItem value="all">All matched cities</SelectItem></SelectContent></Select></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-64 overflow-y-auto border rounded p-2">{filteredCities.map((loc: any) => <label key={loc.slug} className="flex gap-2 text-sm"><Checkbox checked={selectedCitySlugs.has(loc.slug)} onCheckedChange={(checked) => setSelectedCitySlugs((prev) => { const next = new Set(prev); checked ? next.add(loc.slug) : next.delete(loc.slug); return next; })} />{loc.name}, {loc.stateCode}{loc.population ? <span className="text-xs text-muted-foreground">pop. {Number(loc.population).toLocaleString()}</span> : null}</label>)}</div>
            </div>}

            <label className="flex gap-2 items-center text-sm"><Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(!!v)} />Overwrite existing pages</label>
          </CardContent>
        </Card>}

        {websiteId && selectedServices.size > 0 && <Card><CardHeader><CardTitle>Generate</CardTitle><CardDescription>{runBothLocations ? `Will queue selected state page job(s), then ${expandedStateCities.length.toLocaleString()} selected-state city target(s).` : "Polling stops on completed, failed, error, or cancelled."}</CardDescription></CardHeader><CardContent className="space-y-4"><Button size="lg" onClick={runAllServices} disabled={isRunningAll || effectiveTargetCount === 0 || !isClusterReady || (!cycleBlueprints && !blueprintId)}><Play className="size-4 mr-2" />{isRunningAll ? "Running..." : `Generate ${estimatedPages.toLocaleString()} Pages`}</Button>{isRunningAll && activeJobId && <p className="text-xs text-muted-foreground"><Loader2 className="inline size-3 animate-spin mr-1" />Job {bpQueueDisplay.idx + 1} of {bpQueueDisplay.total}: {bpQueueDisplay.label}</p>}{serviceProgress.map((p) => <div key={p.service} className="flex items-center gap-2 border rounded px-3 py-2 text-sm">{p.status === "done" ? <CheckCircle2 className="size-4 text-green-600" /> : p.status === "error" ? <XCircle className="size-4 text-red-600" /> : <Loader2 className="size-4 animate-spin" />}<span className="flex-1">{p.service}</span><span className="text-xs text-muted-foreground">{p.status} · {p.created + p.updated} pages · {p.skipped} skipped · {p.errors} errors</span></div>)}{lastFailure && <div className="border border-red-200 bg-red-50 text-red-700 rounded p-3 text-sm">{lastFailure}</div>}{lastResult && !isRunningAll && <div className="border rounded p-3 text-sm">Generated/updated {lastResult.created.toLocaleString()} · skipped {lastResult.skipped.toLocaleString()} · errors {lastResult.errors.toLocaleString()}</div>}</CardContent></Card>}
      </div>
    </DashboardLayout>
  );
}
