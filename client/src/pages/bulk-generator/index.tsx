import { useState, useMemo } from "react";
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
import { Zap, BookOpen, Play, CheckCircle2, Loader2, Info, Search, FileText, XCircle } from "lucide-react";
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

  const [websiteId, setWebsiteId] = useState<string>("");
  const [blueprintId, setBlueprintId] = useState<string>("");
  const [newService, setNewService] = useState("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[] } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [serviceProgress, setServiceProgress] = useState<Array<{ service: string; status: "pending" | "running" | "done" | "error"; created: number; skipped: number }>>([]);

  const websitesQ = useQuery<any[]>({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const servicesQ = useQuery<string[]>({
    queryKey: ["/api/websites", websiteId, "variation-services"],
    queryFn: () => apiFetch(`/api/websites/${websiteId}/variation-services`),
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

  const contextQ = useQuery<any>({
    queryKey: ["/api/websites", websiteId, "context"],
    queryFn: () => api.get<any>(`/api/websites/${websiteId}/context`),
    enabled: !!websiteId,
  });

  const services = servicesQ.data ?? [];
  const allLocations = locationsQ.data ?? [];
  const blueprints = blueprintsQ.data ?? [];
  const siteContext = contextQ.data ?? null;

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

  const filteredStates = useMemo(() =>
    dbStates.filter((l: any) => !stateSearch || l.name.toLowerCase().includes(stateSearch.toLowerCase()) || l.stateCode?.toLowerCase().includes(stateSearch.toLowerCase())),
    [dbStates, stateSearch]);

  const filteredCities = useMemo(() =>
    dbCities.filter((l: any) => !citySearch || l.name.toLowerCase().includes(citySearch.toLowerCase()) || l.stateCode?.toLowerCase().includes(citySearch.toLowerCase())),
    [dbCities, citySearch]);

  const writeMut = useMutation({
    mutationFn: ({ service }: { service: string }) =>
      apiFetch(`/api/websites/${websiteId}/variation-banks/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      }),
    onSuccess: (data: any, { service }) => {
      const ctx = data?.context;
      const desc = ctx?.brand || ctx?.industry
        ? `Written using ${[ctx.brand, ctx.industry].filter(Boolean).join(" · ")} context`
        : `Content bank ready for "${service}"`;
      toast({ title: `Variations written for "${service}"`, description: desc });
      setNewService("");
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "variation-services"] });
    },
    onError: (err: any) => toast({ title: "Write failed", description: err.message, variant: "destructive" }),
  });

  function buildLocationPayload() {
    if (mode === "all_states") {
      if (dbStates.length > 0) {
        const uniqueCodes = [...new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean))];
        return { mode: "specific_states", states: uniqueCodes };
      }
      return { mode: "all_states" };
    } else if (mode === "specific_states") {
      return { mode: "specific_states", states: Array.from(selectedStateCodes) };
    } else {
      const cityObjs = Array.from(selectedCitySlugs).map(slug => {
        const loc = dbCities.find((l: any) => l.slug === slug);
        return loc ? { name: loc.name, stateAbbr: loc.stateCode } : null;
      }).filter(Boolean);
      return { mode: "specific_cities", cities: cityObjs };
    }
  }

  async function runAllServices() {
    const svcs = Array.from(selectedServices);
    if (svcs.length === 0) return;
    setIsRunningAll(true);
    setCancelRequested(false);
    setLastResult(null);
    setServiceProgress(svcs.map(s => ({ service: s, status: "pending", created: 0, skipped: 0 })));

    let totalCreated = 0, totalSkipped = 0, totalErrors = 0;

    for (let i = 0; i < svcs.length; i++) {
      if (cancelRequested) break;
      const svc = svcs[i];
      setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "running" } : p));
      try {
        const payload: any = { service: svc, ...buildLocationPayload() };
        if (blueprintId) payload.blueprintId = blueprintId;
        const data: any = await apiFetch(`/api/websites/${websiteId}/bulk-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        totalCreated += data.created ?? 0;
        totalSkipped += data.skipped ?? 0;
        totalErrors += data.errors ?? 0;
        setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "done", created: data.created, skipped: data.skipped } : p));
      } catch (err: any) {
        totalErrors++;
        setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "error" } : p));
        toast({ title: `Error on "${svc}"`, description: err.message, variant: "destructive" });
      }
    }

    setIsRunningAll(false);
    setLastResult({ created: totalCreated, skipped: totalSkipped, errors: totalErrors, slugs: [] });
    toast({ title: `Done! ${totalCreated} pages created`, description: `${totalSkipped} skipped, ${totalErrors} errors across ${svcs.length} service(s)` });
    qc.invalidateQueries({ queryKey: ["/api/pages"] });
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

  function toggleState(code: string) {
    setSelectedStateCodes(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }
  function toggleCity(slug: string) {
    setSelectedCitySlugs(prev => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
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
            <Select value={websiteId} onValueChange={v => { setWebsiteId(v); setSelectedServices(new Set()); setBlueprintId(""); setSelectedStateCodes(new Set()); setSelectedCitySlugs(new Set()); setServiceProgress([]); setLastResult(null); }}>
              <SelectTrigger data-testid="select-website" className="w-full max-w-md">
                <SelectValue placeholder="Choose a website..." />
              </SelectTrigger>
              <SelectContent>
                {websites.map((w: any) => (
                  <SelectItem key={w.id} value={w.id} data-testid={`option-website-${w.id}`}>
                    {w.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Step 2 — Blueprint (optional) */}
        {websiteId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                Select Blueprint
                <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span>
              </CardTitle>
              <CardDescription>
                When selected, the blueprint's title, H1, meta, and slug templates are used instead of the defaults. Body content still comes from the variation bank.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {blueprintsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading blueprints...</p>
              ) : blueprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blueprints found for this account. You can still generate pages without one.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
                  {blueprints.map((bp: any) => (
                    <button
                      key={bp.id}
                      onClick={() => setBlueprintId(prev => prev === bp.id ? "" : bp.id)}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${blueprintId === bp.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                      data-testid={`button-blueprint-${bp.id}`}
                    >
                      <FileText className={`size-4 mt-0.5 shrink-0 ${blueprintId === bp.id ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{bp.name}</p>
                        {bp.pageType && <p className="text-xs text-muted-foreground capitalize">{bp.pageType.replace(/_/g, " ")}</p>}
                      </div>
                      {blueprintId === bp.id && <CheckCircle2 className="size-4 text-primary ml-auto shrink-0 mt-0.5" />}
                    </button>
                  ))}
                </div>
              )}
              {blueprintId && (
                <Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground" onClick={() => setBlueprintId("")}>
                  Clear selection
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Variation Banks */}
        {websiteId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                Variation Banks
              </CardTitle>
              <CardDescription>
                Each service needs a content bank (5 Claude Haiku calls, paid once). Pages then generate instantly at zero cost.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Brand + Industry context indicator */}
              {contextQ.isLoading ? null : siteContext && (siteContext.brand || siteContext.industry) ? (
                <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-md bg-blue-50 border border-blue-200 text-xs">
                  <span className="text-blue-700 font-medium">AI context:</span>
                  {siteContext.brand?.name && (
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{siteContext.brand.name}</span>
                  )}
                  {siteContext.industry?.name && (
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{siteContext.industry.name}</span>
                  )}
                  {siteContext.brand?.voiceAndTone && (
                    <span className="text-blue-600 italic truncate max-w-[200px]">{siteContext.brand.voiceAndTone}</span>
                  )}
                </div>
              ) : websiteId ? (
                <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
                  <Info className="size-3.5 shrink-0" />
                  No brand profile or industry set — content will be generic. Add them in Brand Profiles &amp; Industries for better results.
                </div>
              ) : null}

              {services.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Existing banks</p>
                  <div className="flex flex-wrap gap-2">
                    {services.map(svc => (
                      <div key={svc} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-md px-3 py-1.5" data-testid={`badge-service-${svc}`}>
                        <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
                        <span className="text-sm font-medium text-green-800">{svc}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs text-green-700 hover:text-green-900"
                          onClick={() => writeMut.mutate({ service: svc })}
                          disabled={writeMut.isPending}
                          data-testid={`button-rewrite-${svc}`}
                        >
                          {writeMut.isPending && writeMut.variables?.service === svc ? <Loader2 className="size-3 animate-spin" /> : "Rewrite"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">Write new bank</p>
                <div className="flex gap-2 max-w-md">
                  <Input
                    placeholder="e.g. Credit Card Processing"
                    value={newService}
                    onChange={e => setNewService(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && newService.trim() && writeMut.mutate({ service: newService.trim() })}
                    data-testid="input-new-service"
                  />
                  <Button
                    onClick={() => writeMut.mutate({ service: newService.trim() })}
                    disabled={!newService.trim() || writeMut.isPending}
                    data-testid="button-write-bank"
                  >
                    {writeMut.isPending && writeMut.variables?.service === newService.trim()
                      ? <><Loader2 className="size-4 mr-2 animate-spin" /> Writing...</>
                      : <><BookOpen className="size-4 mr-2" /> Write Bank</>}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="size-3" />
                  Makes 5 Claude API calls. Works with <code className="bg-muted px-1 rounded">claude-haiku-4-5-20251001</code>.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Service + Location scope */}
        {websiteId && services.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
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
                  {services.map(svc => (
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
                      <span className="text-sm">{svc}</span>
                    </label>
                  ))}
                </div>
              </div>

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
                          {filteredStates.map((loc: any) => (
                            <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-state-${loc.stateCode}`}>
                              <Checkbox
                                checked={selectedStateCodes.has(loc.stateCode)}
                                onCheckedChange={() => toggleState(loc.stateCode)}
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
                      </div>
                      <ScrollArea className="h-64 border rounded-md p-2">
                        <div className="space-y-0.5">
                          {filteredCities.map((loc: any) => (
                            <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-city-${loc.slug}`}>
                              <Checkbox
                                checked={selectedCitySlugs.has(loc.slug)}
                                onCheckedChange={() => toggleCity(loc.slug)}
                                data-testid={`checkbox-city-${loc.slug}`}
                              />
                              <span className="text-sm font-medium">{loc.name}</span>
                              <span className="text-xs text-muted-foreground">{loc.stateCode}</span>
                              {loc.population > 0 && (
                                <span className="text-xs text-muted-foreground ml-auto">{loc.population?.toLocaleString()}</span>
                              )}
                            </label>
                          ))}
                          {filteredCities.length === 0 && (
                            <p className="text-center py-6 text-muted-foreground text-sm">No cities match.</p>
                          )}
                        </div>
                      </ScrollArea>
                      <p className="text-xs text-muted-foreground">{selectedCitySlugs.size} of {dbCities.length} cities selected</p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 5 — Generate */}
        {websiteId && selectedServices.size > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">5</span>
                Generate Pages
              </CardTitle>
              <CardDescription>
                Will generate up to <strong>{selectedServices.size * targetCount}</strong> pages ({selectedServices.size} service{selectedServices.size !== 1 ? "s" : ""} × {targetCount} location{targetCount !== 1 ? "s" : ""}) — zero AI calls, instant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Button
                  size="lg"
                  onClick={runAllServices}
                  disabled={isRunningAll || targetCount === 0}
                  data-testid="button-generate"
                  className="gap-2"
                >
                  {isRunningAll
                    ? <><Loader2 className="size-4 animate-spin" /> Running...</>
                    : <><Play className="size-4" /> Generate {selectedServices.size * targetCount} Pages</>}
                </Button>
                {isRunningAll && (
                  <Button variant="outline" size="lg" onClick={() => setCancelRequested(true)} data-testid="button-cancel">
                    Cancel
                  </Button>
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
                      </div>
                      <span className={`flex-1 font-medium ${p.status === "pending" ? "text-muted-foreground" : ""}`}>{p.service}</span>
                      {p.status === "done" && (
                        <span className="text-xs text-muted-foreground">
                          <span className="text-green-700 font-semibold">+{p.created}</span>
                          {p.skipped > 0 && <span className="ml-1.5">⊘{p.skipped} skipped</span>}
                        </span>
                      )}
                      {p.status === "running" && <span className="text-xs text-primary">Generating...</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Summary */}
              {lastResult && !isRunningAll && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-1" data-testid="div-results">
                  <p className="font-medium text-sm">Run complete</p>
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-700 font-semibold" data-testid="text-created">✓ {lastResult.created} created</span>
                    <span className="text-muted-foreground" data-testid="text-skipped">⊘ {lastResult.skipped} skipped</span>
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
