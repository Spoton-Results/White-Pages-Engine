import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MapPin, Trash2, Search, Download } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import {
  US_STATES, US_CITIES_CLEAN, US_REGIONS, US_METROS,
  getCitiesByState, getCitiesByRegion, getCitiesByMetro,
} from "@/data/us-locations";

interface LocationImportItem {
  type: "state" | "city";
  name: string;
  slug: string;
  stateCode: string;
  stateName: string;
  population: number;
}

const typeColors: Record<string, string> = {
  state: "bg-violet-500/10 text-violet-600",
  city: "bg-blue-500/10 text-blue-600",
  county: "bg-emerald-500/10 text-emerald-600",
  neighborhood: "bg-amber-500/10 text-amber-600",
};

export default function LocationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const selectedAccount = overrideAccount || (accounts as any[])[0]?.id || "";

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["/api/locations", selectedAccount],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/locations`),
    enabled: !!selectedAccount,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/locations`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      setShowCreate(false);
      reset();
      toast({ title: "Location added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkImport = useMutation({
    mutationFn: (items: LocationImportItem[]) =>
      api.post<{ inserted: number; skipped: number }>(`/api/accounts/${selectedAccount}/locations/bulk`, { locations: items }),
    onSuccess: (result: { inserted: number; skipped: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      setShowBulk(false);
      toast({ title: `${result.inserted} location${result.inserted !== 1 ? "s" : ""} imported${result.skipped > 0 ? ` (${result.skipped} already existed)` : ""}` });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/locations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location removed" });
    },
  });

  const filtered = (locations as any[]).filter((l: any) =>
    !searchText || l.name.toLowerCase().includes(searchText.toLowerCase()) ||
    l.stateCode?.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage target states, cities, and neighborhoods.</p>
          </div>
          {selectedAccount && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" size="sm" onClick={() => setShowBulk(true)} data-testid="button-bulk-import">
                <Download className="size-4" />Bulk Import
              </Button>
              <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-location">
                <Plus className="size-4" />Add Location
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border flex-wrap">
          <Select onValueChange={setOverrideAccount} value={selectedAccount} data-testid="select-account">
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAccount && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9 h-9" value={searchText} onChange={e => setSearchText(e.target.value)} data-testid="input-search-locations" />
            </div>
          )}
          {selectedAccount && <span className="text-sm text-muted-foreground" data-testid="text-location-count">{locations.length} locations</span>}
        </div>

        {!selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <MapPin className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage locations</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Population</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {searchText ? "No locations match." : "No locations added yet. Use Bulk Import to add all US states and cities at once."}
                    </TableCell>
                  </TableRow>
                ) : filtered.map((loc: any) => (
                  <TableRow key={loc.id} data-testid={`row-location-${loc.id}`}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs capitalize ${typeColors[loc.type] || ""}`}>{loc.type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{loc.stateName || loc.stateCode || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{loc.slug}</TableCell>
                    <TableCell className="text-muted-foreground">{loc.population?.toLocaleString() || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => confirm("Remove location?") && remove.mutate(loc.id)}
                        data-testid={`button-delete-location-${loc.id}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Single Add Dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select onValueChange={v => setValue("type", v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="state">State</SelectItem>
                  <SelectItem value="city">City</SelectItem>
                  <SelectItem value="county">County</SelectItem>
                  <SelectItem value="neighborhood">Neighborhood</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="Atlanta" {...register("name", { required: true })} data-testid="input-location-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="atlanta" {...register("slug", { required: true })} data-testid="input-location-slug" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>State Code</Label>
                <Input placeholder="GA" {...register("stateCode")} />
              </div>
              <div className="space-y-1.5">
                <Label>State Name</Label>
                <Input placeholder="Georgia" {...register("stateName")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Population</Label>
              <Input type="number" placeholder="498000" {...register("population", { valueAsNumber: true })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending} data-testid="button-submit-location">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Import Dialog ── */}
      {showBulk && (
        <BulkImportDialog
          open={showBulk}
          onClose={() => setShowBulk(false)}
          onImport={(items: LocationImportItem[]) => bulkImport.mutate(items)}
          isPending={bulkImport.isPending}
        />
      )}
    </DashboardLayout>
  );
}

function BulkImportDialog({
  open, onClose, onImport, isPending,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (items: LocationImportItem[]) => void;
  isPending: boolean;
}) {
  const [tab, setTab] = useState<"states" | "cities" | "region" | "metro" | "csv">("states");
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityStateFilter, setCityStateFilter] = useState("ALL");
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [csvText, setCsvText] = useState("");

  // Build state lookup maps once
  const stateByCode = useMemo(() => new Map(US_STATES.map(s => [s.code.toUpperCase(), s])), []);
  const stateByName = useMemo(() => new Map(US_STATES.map(s => [s.name.toLowerCase(), s])), []);

  const csvParsed = useMemo((): LocationImportItem[] => {
    if (!csvText.trim()) return [];
    const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const results: LocationImportItem[] = [];
    for (const line of lines) {
      // Support: "City, ST" or "City, State Name" or tab-separated
      const parts = line.split(/\t|,(?=[^,]*$)/).map(p => p.trim());
      if (parts.length < 2) continue;
      const cityName = parts[0].trim();
      const stateRaw = parts[parts.length - 1].trim();
      const state = stateByCode.get(stateRaw.toUpperCase()) || stateByName.get(stateRaw.toLowerCase());
      if (!cityName || !state) continue;
      const slug = `${slugify(cityName)}-${state.code.toLowerCase()}`;
      results.push({ type: "city", name: cityName, slug, stateCode: state.code, stateName: state.name, population: 0 });
    }
    // deduplicate by slug
    const seen = new Set<string>();
    return results.filter(r => { if (seen.has(r.slug)) return false; seen.add(r.slug); return true; });
  }, [csvText, stateByCode, stateByName]);

  const filteredStates = useMemo(() =>
    US_STATES.filter(s =>
      !stateSearch || s.name.toLowerCase().includes(stateSearch.toLowerCase()) || s.code.toLowerCase().includes(stateSearch.toLowerCase())
    ), [stateSearch]);

  const filteredCities = useMemo(() => {
    const base = cityStateFilter === "ALL" ? US_CITIES_CLEAN : getCitiesByState(cityStateFilter);
    return base.filter(c =>
      !citySearch || c.name.toLowerCase().includes(citySearch.toLowerCase()) || c.stateCode.toLowerCase().includes(citySearch.toLowerCase())
    );
  }, [cityStateFilter, citySearch]);

  const stateCodesInCities = useMemo(() => {
    const codes = Array.from(new Set(US_CITIES_CLEAN.map(c => c.stateCode))).sort();
    return codes.map(code => ({ code, name: US_STATES.find(s => s.code === code)?.name || code }));
  }, []);

  const regionCounts = useMemo(() =>
    US_REGIONS.map(r => {
      const cities = getCitiesByRegion(r);
      const selected = cities.filter(c => selectedCities.has(c.slug)).length;
      return { region: r, total: cities.length, selected };
    }), [selectedCities]);

  const metroCounts = useMemo(() =>
    US_METROS.map(m => {
      const cities = getCitiesByMetro(m);
      const selected = cities.filter(c => selectedCities.has(c.slug)).length;
      return { metro: m, total: cities.length, selected };
    }).filter(m => m.total > 0), [selectedCities]);

  const allStatesSelected = filteredStates.length > 0 && filteredStates.every(s => selectedStates.has(s.code));
  const allCitiesSelected = filteredCities.length > 0 && filteredCities.every(c => selectedCities.has(c.slug));

  function toggleState(code: string) {
    setSelectedStates(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }
  function toggleCity(slug: string) {
    setSelectedCities(prev => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  }
  function selectAllStates() {
    setSelectedStates(prev => {
      const n = new Set(prev);
      if (allStatesSelected) filteredStates.forEach(s => n.delete(s.code));
      else filteredStates.forEach(s => n.add(s.code));
      return n;
    });
  }
  function selectAllCities() {
    setSelectedCities(prev => {
      const n = new Set(prev);
      if (allCitiesSelected) filteredCities.forEach(c => n.delete(c.slug));
      else filteredCities.forEach(c => n.add(c.slug));
      return n;
    });
  }
  function toggleRegion(region: string) {
    const cities = getCitiesByRegion(region);
    const allSelected = cities.every(c => selectedCities.has(c.slug));
    setSelectedCities(prev => {
      const n = new Set(prev);
      if (allSelected) cities.forEach(c => n.delete(c.slug));
      else cities.forEach(c => n.add(c.slug));
      return n;
    });
  }
  function toggleMetro(metro: string) {
    const cities = getCitiesByMetro(metro);
    const allSelected = cities.every(c => selectedCities.has(c.slug));
    setSelectedCities(prev => {
      const n = new Set(prev);
      if (allSelected) cities.forEach(c => n.delete(c.slug));
      else cities.forEach(c => n.add(c.slug));
      return n;
    });
  }
  function selectAllRegions() {
    setSelectedCities(prev => {
      const n = new Set(prev);
      US_CITIES_CLEAN.forEach(c => n.add(c.slug));
      return n;
    });
  }

  function handleImport() {
    const items: LocationImportItem[] = [];
    Array.from(selectedStates).forEach(code => {
      const st = US_STATES.find(s => s.code === code);
      if (st) items.push({ type: "state", name: st.name, slug: st.slug, stateCode: st.code, stateName: st.name, population: st.population });
    });
    Array.from(selectedCities).forEach(slug => {
      const city = US_CITIES_CLEAN.find(c => c.slug === slug);
      if (city) items.push({ type: "city", name: city.name, slug: city.slug, stateCode: city.stateCode, stateName: city.stateName, population: city.population });
    });
    csvParsed.forEach(c => items.push(c));
    onImport(items);
  }

  const totalSelected = selectedStates.size + selectedCities.size + (tab === "csv" ? csvParsed.length : 0);
  const totalImportable = selectedStates.size + selectedCities.size + csvParsed.length;

  const REGION_COLORS: Record<string, string> = {
    "Northeast": "bg-blue-500/10 text-blue-700 border-blue-200",
    "Southeast": "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    "Midwest": "bg-amber-500/10 text-amber-700 border-amber-200",
    "Southwest": "bg-orange-500/10 text-orange-700 border-orange-200",
    "West": "bg-violet-500/10 text-violet-700 border-violet-200",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" data-testid="dialog-bulk-import">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>Bulk Import Locations</DialogTitle>
            {totalSelected > 0 && (
              <Badge className="bg-primary text-primary-foreground text-sm px-3 py-1" data-testid="badge-selected-count">
                {totalSelected} selected
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Select states, individual cities, or click a region/metro to grab all cities at once.</p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v: any) => setTab(v)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="states" data-testid="tab-states">
              States {selectedStates.size > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{selectedStates.size}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="cities" data-testid="tab-cities">
              Cities {selectedCities.size > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{selectedCities.size}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="region" data-testid="tab-region">By Region</TabsTrigger>
            <TabsTrigger value="metro" data-testid="tab-metro">By Metro</TabsTrigger>
            <TabsTrigger value="csv" data-testid="tab-csv">
              Paste CSV {csvParsed.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{csvParsed.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── States Tab ── */}
          <TabsContent value="states" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Filter states..." className="pl-9 h-9" value={stateSearch}
                  onChange={e => setStateSearch(e.target.value)} data-testid="input-filter-states" />
              </div>
              <Button variant="outline" size="sm" onClick={selectAllStates} data-testid="button-select-all-states">
                {allStatesSelected ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <ScrollArea className="flex-1 h-72 border rounded-md p-2">
              <div className="grid grid-cols-2 gap-1">
                {filteredStates.map(state => (
                  <label key={state.code} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-state-${state.code}`}>
                    <Checkbox checked={selectedStates.has(state.code)} onCheckedChange={() => toggleState(state.code)} data-testid={`checkbox-state-${state.code}`} />
                    <span className="text-sm font-medium">{state.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{state.code}</span>
                  </label>
                ))}
                {filteredStates.length === 0 && <p className="col-span-2 text-center py-6 text-muted-foreground text-sm">No states match.</p>}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{filteredStates.length} of 50 states shown</p>
          </TabsContent>

          {/* ── Cities Tab ── */}
          <TabsContent value="cities" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={cityStateFilter} onValueChange={setCityStateFilter} data-testid="select-city-state-filter">
                <SelectTrigger className="w-44"><SelectValue placeholder="All states" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All states</SelectItem>
                  {stateCodesInCities.map(s => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Filter cities..." className="pl-9 h-9" value={citySearch} onChange={e => setCitySearch(e.target.value)} data-testid="input-filter-cities" />
              </div>
              <Button variant="outline" size="sm" onClick={selectAllCities} data-testid="button-select-all-cities">
                {allCitiesSelected ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <ScrollArea className="flex-1 h-64 border rounded-md p-2">
              <div className="space-y-0.5">
                {filteredCities.map(city => (
                  <label key={city.slug} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`label-city-${city.slug}`}>
                    <Checkbox checked={selectedCities.has(city.slug)} onCheckedChange={() => toggleCity(city.slug)} data-testid={`checkbox-city-${city.slug}`} />
                    <span className="text-sm font-medium">{city.name}</span>
                    <span className="text-xs text-muted-foreground">{city.stateCode}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{city.population?.toLocaleString()}</span>
                  </label>
                ))}
                {filteredCities.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No cities match.</p>}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{filteredCities.length} cities shown ({US_CITIES_CLEAN.length} total)</p>
          </TabsContent>

          {/* ── By Region Tab ── */}
          <TabsContent value="region" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Click a region to select/deselect all its cities at once.</p>
              <Button variant="outline" size="sm" onClick={selectAllRegions} data-testid="button-select-all-regions">
                Select All Cities
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {regionCounts.map(({ region, total, selected }) => {
                const allSel = selected === total;
                const someSel = selected > 0 && !allSel;
                return (
                  <button
                    key={region}
                    onClick={() => toggleRegion(region)}
                    data-testid={`button-region-${region.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                      allSel
                        ? "border-primary bg-primary/5"
                        : someSel
                        ? "border-primary/50 bg-primary/3"
                        : "border-border hover:border-primary/30 hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full border-2 ${allSel ? "bg-primary border-primary" : someSel ? "bg-primary/50 border-primary/50" : "border-muted-foreground"}`} />
                      <div>
                        <span className={`font-semibold ${REGION_COLORS[region]?.split(" ")[1] || ""}`}>{region}</span>
                        <span className="text-xs text-muted-foreground ml-2">{total} cities</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {selected > 0 && (
                        <Badge variant="secondary" className="text-xs">{selected} / {total} selected</Badge>
                      )}
                      {selected === 0 && (
                        <span className="text-xs text-muted-foreground">Click to select all</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </TabsContent>

          {/* ── By Metro Tab ── */}
          <TabsContent value="metro" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <p className="text-sm text-muted-foreground">Click a metro area to select/deselect all cities within it.</p>
            <ScrollArea className="flex-1 h-80 border rounded-md p-2">
              <div className="space-y-1">
                {metroCounts.map(({ metro, total, selected }) => {
                  const allSel = selected === total;
                  return (
                    <button
                      key={metro}
                      onClick={() => toggleMetro(metro)}
                      data-testid={`button-metro-${metro.toLowerCase().replace(/[\s,./]+/g, "-")}`}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors ${
                        allSel ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${allSel ? "bg-primary" : selected > 0 ? "bg-primary/50" : "bg-muted-foreground/30"}`} />
                        <span className="text-sm font-medium">{metro}</span>
                        <span className="text-xs text-muted-foreground">({total} cities)</span>
                      </div>
                      {selected > 0 && (
                        <Badge variant={allSel ? "default" : "secondary"} className="text-xs ml-auto">
                          {allSel ? "All selected" : `${selected}/${total}`}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{metroCounts.length} metro areas</p>
          </TabsContent>

          {/* ── Paste CSV Tab ── */}
          <TabsContent value="csv" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Paste a list of cities — one per line. Accepted formats:
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                <li><code>Austin, TX</code> — city name + 2-letter state code</li>
                <li><code>Austin, Texas</code> — city name + full state name</li>
                <li>Tab-separated columns also work</li>
                <li>Header rows and blank lines are skipped automatically</li>
              </ul>
            </div>
            <Textarea
              className="flex-1 min-h-[220px] font-mono text-xs resize-none"
              placeholder={"Austin, TX\nDallas, TX\nHouston, TX\nDenver, CO\nPhoenix, AZ\n..."}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              data-testid="textarea-csv-cities"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {csvText.trim()
                  ? csvParsed.length > 0
                    ? `✓ ${csvParsed.length} cities parsed successfully`
                    : "⚠ No valid cities found — check format (City, ST)"
                  : "Paste city data above"}
              </p>
              {csvText.trim() && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setCsvText("")}>Clear</Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={isPending || totalImportable === 0}
            data-testid="button-confirm-bulk-import"
          >
            {isPending ? "Importing…" : totalImportable === 0 ? "Select locations to import" : `Import ${totalImportable} location${totalImportable !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
