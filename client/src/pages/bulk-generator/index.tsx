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
import { Zap, Play, CheckCircle2, Loader2, Search, FileText, XCircle, AlertCircle } from "lucide-react";
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
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[]; warning?: string } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [serviceProgress, setServiceProgress] = useState<Array<{ service: string; status: "pending" | "running" | "done" | "error" | "no-bank"; created: number; updated: number; skipped: number }>>([]);

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

  const services = servicesQ.data ?? [];
  const bankServicesSet = new Set<string>(bankServicesQ.data ?? []);
  const allLocations = locationsQ.data ?? [];
  const blueprints = blueprintsQ.data ?? [];

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

  function buildLocationPayload() {
    if (mode === "all_states") {
      if (dbStates.length > 0) {
        const uniqueCodes = Array.from(new Set(dbStates.map((l: any) => l.stateCode).filter(Boolean)));
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
    setServiceProgress(svcs.map(s => ({ service: s, status: "pending", created: 0, updated: 0, skipped: 0 })));

    let totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

    for (let i = 0; i < svcs.length; i++) {
      if (cancelRequested) break;
      const svc = svcs[i];
      // Skip services that don't have variation banks written yet
      if (!bankServicesSet.has(svc)) {
        setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "no-bank" } : p));
        continue;
      }
      setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "running" } : p));
      try {
        const payload: any = { service: svc, ...buildLocationPayload(), overwrite };
        if (blueprintId) payload.blueprintId = blueprintId;
        const data: any = await apiFetch(`/api/websites/${websiteId}/bulk-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        totalCreated += data.created ?? 0;
        totalUpdated += data.updated ?? 0;
        totalSkipped += data.skipped ?? 0;
        totalErrors += data.errors ?? 0;
        if (data.warning) {
          toast({ title: "Blueprint template warning", description: data.warning, variant: "destructive" });
        }
        setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "done", created: data.created ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 } : p));
      } catch (err: any) {
        totalErrors++;
        setServiceProgress(prev => prev.map(p => p.service === svc ? { ...p, status: "error" } : p));
        toast({ title: `Error on "${svc}"`, description: err.message, variant: "destructive" });
      }
    }

    setIsRunningAll(false);
    setLastResult({ created: totalCreated + totalUpdated, skipped: totalSkipped, errors: totalErrors, slugs: [] });
    const summary = totalUpdated > 0
      ? `${totalCreated} new, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`
      : `${totalSkipped} skipped, ${totalErrors} errors across ${svcs.length} service(s)`;
    toast({ title: `Done! ${totalCreated + totalUpdated} pages processed`, description: summary });
    qc.invalidateQueries({ queryKey: ["/api/pages"] });

    // Auto-regenerate sitemap so new pages are immediately indexed by Google
    if (totalCreated + totalUpdated > 0 && websiteId) {
      try {
        await apiFetch(`/api/websites/${websiteId}/sitemaps/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        toast({ title: "Sitemap updated", description: "New pages are now included in your sitemap and ready for Google indexing." });
      } catch {
        // Non-critical — user can regenerate manually from Sitemap Manager
      }
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

              {/* Options */}
              <div className="pt-1 border-t">
                <label className="flex items-center gap-2.5 cursor-pointer w-fit" data-testid="label-overwrite">
                  <Checkbox
                    checked={overwrite}
                    onCheckedChange={v => setOverwrite(!!v)}
                    data-testid="checkbox-overwrite"
                  />
                  <span className="text-sm font-medium">Overwrite existing pages</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  When checked, pages that already exist will be regenerated with fresh content from the variation bank. Leave unchecked to skip existing pages.
                </p>
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
                Will {overwrite ? "create or update" : "create up to"} <strong>{selectedServices.size * targetCount}</strong> pages ({selectedServices.size} service{selectedServices.size !== 1 ? "s" : ""} × {targetCount} location{targetCount !== 1 ? "s" : ""}) — zero AI calls, instant.
                {overwrite && <span className="text-blue-600 font-medium"> Overwrite mode on — existing pages will be regenerated.</span>}
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
                        {p.status === "no-bank" && <AlertCircle className="size-4 text-amber-500" />}
                      </div>
                      <span className={`flex-1 font-medium ${p.status === "pending" ? "text-muted-foreground" : ""}`}>{p.service}</span>
                      {p.status === "done" && (
                        <span className="text-xs text-muted-foreground">
                          {p.created > 0 && <span className="text-green-700 font-semibold">+{p.created}</span>}
                          {p.updated > 0 && <span className={`text-blue-700 font-semibold${p.created > 0 ? " ml-1.5" : ""}`}>↻{p.updated} updated</span>}
                          {p.skipped > 0 && <span className="ml-1.5">⊘{p.skipped} skipped</span>}
                          {p.created === 0 && p.updated === 0 && p.skipped === 0 && <span>done</span>}
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
