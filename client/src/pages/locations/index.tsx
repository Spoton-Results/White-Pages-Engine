import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
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
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { US_STATES, US_CITIES_CLEAN, getCitiesByState } from "@/data/us-locations";

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
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["/api/locations", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/locations`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  useEffect(() => {
    if ((accounts as any[]).length > 0 && !selectedAccount) {
      setSelectedAccount((accounts as any[])[0].id);
    }
  }, [accounts]);

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
          <Select onValueChange={setSelectedAccount} value={selectedAccount} data-testid="select-account">
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
  const [tab, setTab] = useState<"states" | "cities">("states");
  const [stateSearch, setStateSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityStateFilter, setCityStateFilter] = useState("ALL");
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());

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

  const totalSelected = selectedStates.size + selectedCities.size;

  const allStatesSelected = filteredStates.length > 0 && filteredStates.every(s => selectedStates.has(s.code));
  const allCitiesSelected = filteredCities.length > 0 && filteredCities.every(c => selectedCities.has(c.slug));

  function toggleState(code: string) {
    setSelectedStates(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleCity(slug: string) {
    setSelectedCities(prev => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  function selectAllStates() {
    if (allStatesSelected) {
      setSelectedStates(prev => {
        const next = new Set(prev);
        filteredStates.forEach(s => next.delete(s.code));
        return next;
      });
    } else {
      setSelectedStates(prev => {
        const next = new Set(prev);
        filteredStates.forEach(s => next.add(s.code));
        return next;
      });
    }
  }

  function selectAllCities() {
    if (allCitiesSelected) {
      setSelectedCities(prev => {
        const next = new Set(prev);
        filteredCities.forEach(c => next.delete(c.slug));
        return next;
      });
    } else {
      setSelectedCities(prev => {
        const next = new Set(prev);
        filteredCities.forEach(c => next.add(c.slug));
        return next;
      });
    }
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
    onImport(items);
  }

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
          <p className="text-sm text-muted-foreground">Select any combination of states and cities to import at once. Duplicates are skipped automatically.</p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v: string) => { if (v === "states" || v === "cities") setTab(v); }} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="states" data-testid="tab-states">
              States {selectedStates.size > 0 && <Badge variant="secondary" className="ml-2 text-xs">{selectedStates.size}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="cities" data-testid="tab-cities">
              Cities {selectedCities.size > 0 && <Badge variant="secondary" className="ml-2 text-xs">{selectedCities.size}</Badge>}
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
                  <label
                    key={state.code}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                    data-testid={`label-state-${state.code}`}
                  >
                    <Checkbox
                      checked={selectedStates.has(state.code)}
                      onCheckedChange={() => toggleState(state.code)}
                      data-testid={`checkbox-state-${state.code}`}
                    />
                    <span className="text-sm font-medium">{state.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{state.code}</span>
                  </label>
                ))}
                {filteredStates.length === 0 && (
                  <p className="col-span-2 text-center py-6 text-muted-foreground text-sm">No states match.</p>
                )}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{filteredStates.length} of 50 states shown</p>
          </TabsContent>

          {/* ── Cities Tab ── */}
          <TabsContent value="cities" className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={cityStateFilter} onValueChange={setCityStateFilter} data-testid="select-city-state-filter">
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All states</SelectItem>
                  {stateCodesInCities.map(s => (
                    <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Filter cities..." className="pl-9 h-9" value={citySearch}
                  onChange={e => setCitySearch(e.target.value)} data-testid="input-filter-cities" />
              </div>
              <Button variant="outline" size="sm" onClick={selectAllCities} data-testid="button-select-all-cities">
                {allCitiesSelected ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <ScrollArea className="flex-1 h-64 border rounded-md p-2">
              <div className="space-y-0.5">
                {filteredCities.map(city => (
                  <label
                    key={city.slug}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                    data-testid={`label-city-${city.slug}`}
                  >
                    <Checkbox
                      checked={selectedCities.has(city.slug)}
                      onCheckedChange={() => toggleCity(city.slug)}
                      data-testid={`checkbox-city-${city.slug}`}
                    />
                    <span className="text-sm font-medium">{city.name}</span>
                    <span className="text-xs text-muted-foreground">{city.stateCode}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{city.population?.toLocaleString()}</span>
                  </label>
                ))}
                {filteredCities.length === 0 && (
                  <p className="text-center py-6 text-muted-foreground text-sm">No cities match.</p>
                )}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{filteredCities.length} cities shown</p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={isPending || totalSelected === 0}
            data-testid="button-confirm-bulk-import"
          >
            {isPending ? "Importing…" : totalSelected === 0 ? "Select locations to import" : `Import ${totalSelected} location${totalSelected !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
