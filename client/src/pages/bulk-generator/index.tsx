import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, BookOpen, Play, CheckCircle2, Loader2, ChevronDown, ChevronUp, Info } from "lucide-react";

const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
];

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function useWebsites() {
  return useQuery<any[]>({ queryKey: ["/api/websites"], queryFn: () => apiFetch("/api/websites") });
}

function useVariationServices(websiteId: string | null) {
  return useQuery<string[]>({
    queryKey: ["/api/websites", websiteId, "variation-services"],
    queryFn: () => apiFetch(`/api/websites/${websiteId}/variation-services`),
    enabled: !!websiteId,
  });
}

export default function BulkGeneratorPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [websiteId, setWebsiteId] = useState<string>("");
  const [newService, setNewService] = useState("");
  const [selectedService, setSelectedService] = useState<string>("");
  const [mode, setMode] = useState<"all_states" | "specific_states" | "specific_cities">("all_states");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [cityInput, setCityInput] = useState("");
  const [cities, setCities] = useState<Array<{ name: string; stateAbbr: string }>>([]);
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number; errors: number; slugs: string[] } | null>(null);
  const [showSlugs, setShowSlugs] = useState(false);

  const websitesQ = useWebsites();
  const servicesQ = useVariationServices(websiteId || null);
  const writingServices = useState<string[]>([])[0];

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
    mutationFn: () =>
      apiFetch(`/api/websites/${websiteId}/bulk-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: selectedService, mode, states: selectedStates, cities }),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      toast({ title: `Generated ${data.created} pages`, description: `${data.skipped} skipped (already exist), ${data.errors} errors` });
      qc.invalidateQueries({ queryKey: ["/api/pages"] });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const toggleState = (abbr: string) => {
    setSelectedStates(prev => prev.includes(abbr) ? prev.filter(s => s !== abbr) : [...prev, abbr]);
  };

  const addCity = () => {
    const parts = cityInput.trim().split(",");
    if (parts.length < 2) {
      toast({ title: "Invalid format", description: "Enter city as: City Name, ST", variant: "destructive" });
      return;
    }
    const name = parts[0].trim();
    const stateAbbr = parts[1].trim().toUpperCase();
    if (stateAbbr.length !== 2) {
      toast({ title: "Invalid state", description: "Use 2-letter state abbreviation", variant: "destructive" });
      return;
    }
    setCities(prev => [...prev, { name, stateAbbr }]);
    setCityInput("");
  };

  const websites = websitesQ.data ?? [];
  const services = servicesQ.data ?? [];

  const targetCount = mode === "all_states" ? 50
    : mode === "specific_states" ? selectedStates.length
    : cities.length;

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
            <Select value={websiteId} onValueChange={v => { setWebsiteId(v); setSelectedService(""); }}>
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
              {/* Existing banks */}
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

              {/* Add new bank */}
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
                    { value: "all_states", label: "All 50 States", count: "50 pages" },
                    { value: "specific_states", label: "Specific States", count: `${selectedStates.length} selected` },
                    { value: "specific_cities", label: "Specific Cities", count: `${cities.length} added` },
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
              </div>

              {/* State picker */}
              {mode === "specific_states" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Click states to toggle</p>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1">
                    {US_STATES.map(([abbr, name]) => (
                      <button
                        key={abbr}
                        onClick={() => toggleState(abbr)}
                        className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${selectedStates.includes(abbr) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                        data-testid={`button-state-${abbr}`}
                        title={name}
                      >
                        {abbr}
                      </button>
                    ))}
                  </div>
                  {selectedStates.length > 0 && (
                    <p className="text-xs text-muted-foreground">{selectedStates.length} state(s) selected</p>
                  )}
                </div>
              )}

              {/* City input */}
              {mode === "specific_cities" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Add cities (format: City Name, ST)</p>
                  <div className="flex gap-2 max-w-md">
                    <Input
                      placeholder="e.g. Austin, TX"
                      value={cityInput}
                      onChange={e => setCityInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addCity()}
                      data-testid="input-city"
                    />
                    <Button variant="outline" onClick={addCity} data-testid="button-add-city">Add</Button>
                  </div>
                  {cities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {cities.map((c, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => setCities(prev => prev.filter((_, idx) => idx !== i))}
                          data-testid={`badge-city-${i}`}
                        >
                          {c.name}, {c.stateAbbr} ×
                        </Badge>
                      ))}
                    </div>
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
