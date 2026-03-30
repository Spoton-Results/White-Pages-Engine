import { useState, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, BookOpen, Play, CheckCircle2, Loader2, ChevronDown, ChevronUp, Info, Search } from "lucide-react";
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
  const [newService, setNewService] = useState("");
  const [selectedService, setSelectedService] = useState<string>("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(new Set());
  const [selectedCitySlugs, setSelectedCitySlugs] = useState<Set<string>>(new Set());
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[] } | null>(null);
  const [showSlugs, setShowSlugs] = useState(false);

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
  const services = servicesQ.data ?? [];
  const allLocations = locationsQ.data ?? [];

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
    onSuccess: (_, { service }) => {
      toast({ title: "Variations written", description: `Content bank ready for "${service}"` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "variation-services"] });
    },
    onError: (err: any) => toast({ title: "Write failed", description: err.message, variant: "destructive" }),
  });

  const generateMut = useMutation({
    mutationFn: () => {
      let payload: any = { service: selectedService };

      if (mode === "all_states") {
        if (dbStates.length > 0) {
          // Use actual imported states
          payload.mode = "specific_states";
          payload.states = dbStates.map((l: any) => l.stateCode).filter(Boolean);
        } else {
          payload.mode = "all_states";
        }
      } else if (mode === "specific_states") {
        payload.mode = "specific_states";
        payload.states = Array.from(selectedStateCodes);
      } else {
        payload.mode = "specific_cities";
        const cityObjs = Array.from(selectedCitySlugs).map(slug => {
          const loc = dbCities.find((l: any) => l.slug === slug);
          return loc ? { name: loc.name, stateAbbr: loc.stateCode } : null;
        }).filter(Boolean);
        payload.cities = cityObjs;
      }

      return apiFetch(`/api/websites/${websiteId}/bulk-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast({ title: `Generated ${data.created} pages`, description: `${data.skipped} skipped (already exist), ${data.errors} errors` });
      qc.invalidateQueries({ queryKey: ["/api/pages"] });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const targetCount = mode === "all_states"
    ? (dbStates.length > 0 ? dbStates.length : 50)
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
            <Select value={websiteId} onValueChange={v => { setWebsiteId(v); setSelectedService(""); setSelectedStateCodes(new Set()); setSelectedCitySlugs(new Set()); }}>
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

        {/* Step 2 — Variation Banks */}
        {websiteId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                Variation Banks
              </CardTitle>
              <CardDescription>
                Each service needs a content bank (5 Claude calls once). After writing, pages generate instantly at zero cost.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                Configure Generation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Service */}
              <div className="space-y-1.5">
                <Label>Service</Label>
                <Select value={selectedService} onValueChange={setSelectedService}>
                  <SelectTrigger data-testid="select-service" className="w-full max-w-md">
                    <SelectValue placeholder="Choose a service with a bank..." />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map(svc => (
                      <SelectItem key={svc} value={svc} data-testid={`option-service-${svc}`}>{svc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

        {/* Step 4 — Generate */}
        {websiteId && selectedService && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                Generate Pages
              </CardTitle>
              <CardDescription>
                Ready to generate <strong>{targetCount}</strong> page(s) for <strong>{selectedService}</strong> — zero API calls, instant results.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                size="lg"
                onClick={() => generateMut.mutate()}
                disabled={generateMut.isPending || targetCount === 0}
                data-testid="button-generate"
                className="gap-2"
              >
                {generateMut.isPending
                  ? <><Loader2 className="size-4 animate-spin" /> Generating {targetCount} pages...</>
                  : <><Play className="size-4" /> Generate {targetCount} Page{targetCount !== 1 ? "s" : ""}</>}
              </Button>

              {lastResult && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2" data-testid="div-results">
                  <p className="font-medium text-sm">Last run results</p>
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-700 font-semibold" data-testid="text-created">✓ {lastResult.created} created</span>
                    <span className="text-muted-foreground" data-testid="text-skipped">⊘ {lastResult.skipped} skipped</span>
                    {lastResult.errors > 0 && <span className="text-red-600" data-testid="text-errors">✗ {lastResult.errors} errors</span>}
                  </div>
                  {lastResult.slugs.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowSlugs(v => !v)}
                        className="text-xs text-primary flex items-center gap-1 mt-1"
                        data-testid="button-toggle-slugs"
                      >
                        {showSlugs ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        {showSlugs ? "Hide" : "Show"} {lastResult.slugs.length} slug(s)
                      </button>
                      {showSlugs && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded border bg-background text-xs p-2 space-y-0.5" data-testid="list-slugs">
                          {lastResult.slugs.map(slug => <div key={slug} className="font-mono text-muted-foreground">/{slug}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
