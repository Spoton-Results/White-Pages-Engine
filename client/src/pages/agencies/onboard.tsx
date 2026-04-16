import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Plus, Loader2, CheckCircle2,
  XCircle, Building2, MapPin, Layout, Rocket, RefreshCw, Briefcase,
} from "lucide-react";

const INDUSTRIES = [
  "Merchant Services", "Construction", "HVAC", "Plumbing", "Roofing",
  "Landscaping", "Legal", "Medical", "Real Estate", "Other",
];

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const STEP_LABELS = ["Business Info", "Services", "Locations", "Blueprints", "Review & Launch"];

const BLUEPRINT_DEFS = [
  {
    name: "Service City Pages",
    pageType: "service_city",
    description: "Targets a specific service in a specific city. These are your core local SEO pages.",
  },
  {
    name: "State Hub Pages",
    pageType: "state_hub",
    description: "Overview pages for a service across an entire state. Great for broad geo coverage.",
  },
  {
    name: "Problem Intent Pages",
    pageType: "problem_intent",
    description: "Captures 'near me' and problem-based search queries in specific cities.",
  },
];

const LAUNCH_STEP_LABELS = [
  "Creating account...",
  "Creating website...",
  "Writing brand profile...",
  "Adding services...",
  "Setting up locations...",
  "Building blueprints...",
  "Writing variation banks...",
];

interface ServiceItem {
  name: string;
  slug: string;
  description: string;
  keywords: string[];
  enabled: boolean;
}

interface WizardForm {
  businessName: string;
  domain: string;
  industry: string;
  primaryCity: string;
  primaryState: string;
  brandColor: string;
  tagline: string;
}

export default function OnboardWizard() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const [, navigate] = useLocation();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardForm>({
    businessName: "", domain: "", industry: "", primaryCity: "",
    primaryState: "", brandColor: "", tagline: "",
  });
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [cityTiers, setCityTiers] = useState<number[]>([1, 2]);

  const [loadingServices, setLoadingServices] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [customInput, setCustomInput] = useState("");
  const servicesLoadedFor = useRef("");

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchAnimStep, setLaunchAnimStep] = useState(0);
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [retryData, setRetryData] = useState<{ fromStep: number; prevData: any } | null>(null);

  const { data: agency } = useQuery({
    queryKey: ["/api/agencies", agencyId],
    queryFn: () => api.get<any>(`/api/agencies/${agencyId}`),
    enabled: !!agencyId,
  });

  const fetchServices = async () => {
    if (!form.businessName || !form.industry) return;
    const key = `${form.businessName}__${form.industry}`;
    if (servicesLoadedFor.current === key) return;
    servicesLoadedFor.current = key;
    setLoadingServices(true);
    setServiceError("");
    try {
      const result = await api.post<any[]>(`/api/agencies/${agencyId}/wizard/suggest-services`, {
        businessName: form.businessName,
        industry: form.industry,
      });
      setServices((result ?? []).map((s: any) => ({ ...s, enabled: true })));
    } catch (e: any) {
      setServiceError(e.message || "Failed to generate services");
      servicesLoadedFor.current = "";
    }
    setLoadingServices(false);
  };

  useEffect(() => {
    if (step === 2) {
      fetchServices();
    }
    if (step === 3 && selectedStates.length === 0 && form.primaryState) {
      setSelectedStates([form.primaryState]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const addCustomService = () => {
    const name = customInput.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    setServices(prev => [...prev, { name, slug, description: "", keywords: [], enabled: true }]);
    setCustomInput("");
  };

  const toggleState = (code: string) => {
    setSelectedStates(prev =>
      prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]
    );
  };

  const toggleTier = (tier: number) => {
    setCityTiers(prev =>
      prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier].sort((a, b) => a - b)
    );
  };

  const enabledServices = services.filter(s => s.enabled);

  const estimatedPages = (() => {
    const perState =
      (cityTiers.includes(1) ? 2 : 0) +
      (cityTiers.includes(2) ? 8 : 0) +
      (cityTiers.includes(3) ? 50 : 0);
    const raw = enabledServices.length * selectedStates.length * perState * BLUEPRINT_DEFS.length;
    return Math.max(Math.round(raw / 100) * 100, 0);
  })();

  const canAdvance = (): boolean => {
    if (step === 1) {
      return !!(form.businessName.trim() && form.domain.trim() && form.industry && form.primaryCity.trim() && form.primaryState);
    }
    if (step === 2) return enabledServices.length > 0;
    if (step === 3) return selectedStates.length > 0 && cityTiers.length > 0;
    if (step === 4) return true;
    return false;
  };

  const launch = async (fromStep = 1, prevData: any = {}) => {
    setIsLaunching(true);
    setLaunchResult(null);
    setLaunchAnimStep(fromStep - 1);

    const interval = setInterval(() => {
      setLaunchAnimStep(prev => Math.min(prev + 1, 6));
    }, 2800);

    try {
      const result = await api.post<any>(`/api/agencies/${agencyId}/wizard/launch`, {
        ...form,
        selectedServices: enabledServices,
        selectedStates,
        cityTiers,
        retryFromStep: fromStep,
        previousData: prevData,
      });
      setLaunchResult(result);
      if (!result.success) {
        setRetryData({
          fromStep: result.failedStep ?? fromStep,
          prevData: {
            accountId: result.accountId,
            websiteId: result.websiteId,
            brandProfileId: result.brandProfileId,
          },
        });
      }
    } catch (e: any) {
      setLaunchResult({ success: false, error: e.message, failedStep: fromStep, steps: [] });
      setRetryData({ fromStep, prevData });
    } finally {
      clearInterval(interval);
      setIsLaunching(false);
    }
  };

  const failedStepEntry = launchResult?.steps?.find((s: any) => !s.success);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/agencies")}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              data-testid="button-back-to-agencies"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div>
              <p className="text-xs text-muted-foreground">{(agency as any)?.name ?? "Agency"}</p>
              <h1 className="text-lg font-semibold leading-tight">Add New Client</h1>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">Step {step} of 5</div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="border-b bg-card/50 flex-shrink-0">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-1 overflow-x-auto">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={n} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="size-3" />
                  ) : (
                    <span className="size-3.5 inline-flex items-center justify-center font-semibold">{n}</span>
                  )}
                  {label}
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <ChevronRight className="size-3 text-muted-foreground flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">

          {/* ── Step 1: Business Info ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />Business Info
                </h2>
                <p className="text-sm text-muted-foreground mt-1">Tell us about the client's business.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="businessName">Client business name *</Label>
                  <Input
                    id="businessName"
                    placeholder="Acme Plumbing Co"
                    value={form.businessName}
                    onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
                    data-testid="input-business-name"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="domain">Primary domain (no https) *</Label>
                  <Input
                    id="domain"
                    placeholder="acmeplumbing.com"
                    value={form.domain}
                    onChange={e => setForm(f => ({ ...f, domain: e.target.value.replace(/^https?:\/\//, "") }))}
                    data-testid="input-domain"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="industry">Industry *</Label>
                  <Select value={form.industry} onValueChange={v => setForm(f => ({ ...f, industry: v }))}>
                    <SelectTrigger data-testid="select-industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map(ind => (
                        <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="primaryCity">Primary city *</Label>
                  <Input
                    id="primaryCity"
                    placeholder="Austin"
                    value={form.primaryCity}
                    onChange={e => setForm(f => ({ ...f, primaryCity: e.target.value }))}
                    data-testid="input-primary-city"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="primaryState">Primary state *</Label>
                  <Select value={form.primaryState} onValueChange={v => setForm(f => ({ ...f, primaryState: v }))}>
                    <SelectTrigger data-testid="select-primary-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => (
                        <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brandColor">Brand color (hex, optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="brandColor"
                      placeholder="#2563eb"
                      value={form.brandColor}
                      onChange={e => setForm(f => ({ ...f, brandColor: e.target.value }))}
                      data-testid="input-brand-color"
                    />
                    {form.brandColor && (
                      <div
                        className="size-9 rounded border flex-shrink-0"
                        style={{ background: form.brandColor }}
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tagline">Tagline (optional)</Label>
                  <Input
                    id="tagline"
                    placeholder="Fast, reliable service"
                    value={form.tagline}
                    onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                    data-testid="input-tagline"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Services ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Briefcase className="size-5 text-primary" />Services
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  AI-suggested services for {form.businessName}. Uncheck any you don't want, or add your own.
                </p>
              </div>

              {loadingServices ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Generating services with AI...</p>
                </div>
              ) : serviceError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                  <p className="text-sm text-destructive">{serviceError}</p>
                  <Button size="sm" variant="outline" onClick={fetchServices} data-testid="button-retry-services">
                    Try Again
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {services.map((svc, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors"
                        data-testid={`service-item-${i}`}
                      >
                        <Checkbox
                          checked={svc.enabled}
                          onCheckedChange={checked => {
                            setServices(prev =>
                              prev.map((s, j) => j === i ? { ...s, enabled: !!checked } : s)
                            );
                          }}
                          className="mt-0.5 flex-shrink-0"
                          data-testid={`checkbox-service-${i}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{svc.name}</div>
                          {svc.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{svc.description}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add custom service..."
                      value={customInput}
                      onChange={e => setCustomInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomService(); } }}
                      data-testid="input-custom-service"
                    />
                    <Button size="sm" variant="outline" onClick={addCustomService} data-testid="button-add-custom-service">
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {enabledServices.length} service{enabledServices.length !== 1 ? "s" : ""} selected
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Locations ── */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <MapPin className="size-5 text-primary" />Locations
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Select target states and city size tiers for page generation.
                </p>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="font-medium">Target States</Label>
                    <div className="flex gap-3">
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setSelectedStates(US_STATES.map(s => s.code))}
                        data-testid="button-select-all-states"
                      >
                        Select All
                      </button>
                      <button
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => setSelectedStates([])}
                        data-testid="button-clear-states"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-6 sm:grid-cols-9 gap-1.5 p-3 rounded-lg border bg-muted/20 max-h-56 overflow-y-auto">
                    {US_STATES.map(s => (
                      <button
                        key={s.code}
                        onClick={() => toggleState(s.code)}
                        className={`px-1.5 py-1.5 text-xs font-mono rounded border transition-colors ${
                          selectedStates.includes(s.code)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card hover:bg-accent border-border text-muted-foreground hover:text-foreground"
                        }`}
                        data-testid={`state-btn-${s.code}`}
                        title={s.name}
                      >
                        {s.code}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {selectedStates.length} state{selectedStates.length !== 1 ? "s" : ""} selected
                  </p>
                </div>

                <div>
                  <Label className="font-medium mb-3 block">City Tier Targeting</Label>
                  <div className="space-y-2">
                    {[
                      { tier: 1, label: "Include Tier 1 Cities", desc: "Population 500K+" },
                      { tier: 2, label: "Include Tier 2 Cities", desc: "Population 100K–500K" },
                      { tier: 3, label: "Include Tier 3 Cities", desc: "Population under 100K" },
                    ].map(({ tier, label, desc }) => (
                      <label
                        key={tier}
                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors"
                        data-testid={`label-tier-${tier}`}
                      >
                        <Checkbox
                          checked={cityTiers.includes(tier)}
                          onCheckedChange={() => toggleTier(tier)}
                          data-testid={`checkbox-tier-${tier}`}
                        />
                        <div>
                          <div className="text-sm font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground">{desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Blueprints ── */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Layout className="size-5 text-primary" />Blueprints
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  These 3 standard blueprints will be created for {form.businessName}.
                </p>
              </div>
              <div className="space-y-3">
                {BLUEPRINT_DEFS.map((bp, i) => (
                  <div key={i} className="p-4 rounded-lg border bg-card" data-testid={`blueprint-${i}`}>
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Layout className="size-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{bp.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{bp.description}</div>
                        <Badge variant="secondary" className="mt-2 text-[10px] font-mono">{bp.pageType}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-400">
                Blueprints can be customized after setup from the Blueprints section.
              </div>
            </div>
          )}

          {/* ── Step 5: Review & Launch ── */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Rocket className="size-5 text-primary" />Review &amp; Launch
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the setup and create the client.
                </p>
              </div>

              {/* Summary card — shown before launch */}
              {!isLaunching && !launchResult && (
                <>
                  <div className="rounded-lg border bg-card p-5 space-y-4" data-testid="summary-card">
                    <div className="flex items-center gap-3">
                      <div
                        className="size-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: form.brandColor || undefined }}
                      >
                        {!form.brandColor && <Building2 className="size-5 text-primary" />}
                        {form.brandColor && <Building2 className="size-5 text-white" />}
                      </div>
                      <div>
                        <div className="font-semibold">{form.businessName}</div>
                        <div className="text-sm text-muted-foreground font-mono">{form.domain}</div>
                      </div>
                      <Badge variant="outline" className="ml-auto">{form.industry}</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md bg-muted/50 p-3">
                        <div className="text-xs text-muted-foreground mb-0.5">Services</div>
                        <div className="font-semibold">{enabledServices.length} selected</div>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <div className="text-xs text-muted-foreground mb-0.5">States</div>
                        <div className="font-semibold">{selectedStates.length} selected</div>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <div className="text-xs text-muted-foreground mb-0.5">City Tiers</div>
                        <div className="font-semibold">
                          {cityTiers.length > 0 ? `Tier ${cityTiers.join(", ")}` : "None"}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <div className="text-xs text-muted-foreground mb-0.5">Blueprints</div>
                        <div className="font-semibold">3 will be created</div>
                      </div>
                    </div>

                    <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                      <div className="text-xs text-muted-foreground mb-0.5">Estimated pages possible</div>
                      <div className="font-bold text-xl text-primary">~{estimatedPages.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {enabledServices.length} services × ~{
                          selectedStates.length * (
                            (cityTiers.includes(1) ? 2 : 0) +
                            (cityTiers.includes(2) ? 8 : 0) +
                            (cityTiers.includes(3) ? 50 : 0)
                          )
                        } locations × {BLUEPRINT_DEFS.length} blueprints
                      </div>
                    </div>
                  </div>

                  <Button
                    className="w-full gap-2 h-11 text-base"
                    onClick={() => launch()}
                    data-testid="button-create-client"
                  >
                    <Rocket className="size-5" />Create Client and Begin Setup
                  </Button>
                </>
              )}

              {/* Progress during launch */}
              {isLaunching && (
                <div className="rounded-lg border bg-card p-6 space-y-5" data-testid="launch-progress">
                  <div className="flex items-center gap-3">
                    <Loader2 className="size-6 animate-spin text-primary flex-shrink-0" />
                    <div>
                      <div className="font-medium">{LAUNCH_STEP_LABELS[launchAnimStep]}</div>
                      <div className="text-sm text-muted-foreground">Setting up {form.businessName}...</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{LAUNCH_STEP_LABELS[launchAnimStep].replace("...", "")}</span>
                      <span>{launchAnimStep + 1} / 7</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-700"
                        style={{ width: `${((launchAnimStep + 1) / 7) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {LAUNCH_STEP_LABELS.map((label, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 text-xs transition-colors ${
                          i < launchAnimStep
                            ? "text-emerald-600"
                            : i === launchAnimStep
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {i < launchAnimStep ? (
                          <CheckCircle2 className="size-3 flex-shrink-0" />
                        ) : i === launchAnimStep ? (
                          <Loader2 className="size-3 animate-spin flex-shrink-0" />
                        ) : (
                          <div className="size-3 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                        )}
                        {label.replace("...", "")}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Result */}
              {launchResult && !isLaunching && (
                <div className="space-y-4">
                  {launchResult.success ? (
                    <div
                      className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-5 space-y-3"
                      data-testid="launch-success"
                    >
                      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                        <CheckCircle2 className="size-5 flex-shrink-0" />
                        Client setup complete.
                      </div>
                      <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
                        Variation banks are being written in the background. Check Bank Health in a few minutes before running your first generation job.
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          className="gap-2"
                          onClick={() => navigate(`/bank-health?websiteId=${launchResult.websiteId}`)}
                          data-testid="button-go-to-client"
                        >
                          Go to Client Dashboard
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => navigate("/agencies")}
                          data-testid="button-back-to-agency"
                        >
                          Back to Agencies
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 space-y-4"
                      data-testid="launch-error"
                    >
                      <div className="flex items-center gap-2 text-destructive font-semibold">
                        <XCircle className="size-5 flex-shrink-0" />
                        Setup failed{failedStepEntry ? ` at: ${failedStepEntry.name}` : ""}.
                      </div>
                      {(failedStepEntry?.error || launchResult.error) && (
                        <p className="text-sm text-muted-foreground bg-muted rounded px-3 py-2 font-mono text-xs">
                          {failedStepEntry?.error || launchResult.error}
                        </p>
                      )}
                      {launchResult.steps?.length > 0 && (
                        <div className="space-y-1.5">
                          {launchResult.steps.map((s: any, i: number) => (
                            <div
                              key={i}
                              className={`flex items-center gap-2 text-xs ${
                                s.success ? "text-emerald-600" : "text-destructive"
                              }`}
                            >
                              {s.success ? (
                                <CheckCircle2 className="size-3 flex-shrink-0" />
                              ) : (
                                <XCircle className="size-3 flex-shrink-0" />
                              )}
                              {s.name}
                              {s.skipped && <span className="text-muted-foreground">(skipped)</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {retryData && (
                        <Button
                          variant="outline"
                          className="gap-2"
                          onClick={() => launch(retryData.fromStep, retryData.prevData)}
                          data-testid="button-retry"
                        >
                          <RefreshCw className="size-4" />
                          Retry from here: {LAUNCH_STEP_LABELS[(retryData.fromStep ?? 1) - 1]}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          {!isLaunching && !launchResult?.success && (
            <div className="flex items-center justify-between pt-8 mt-8 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  if (step > 1) setStep(s => s - 1);
                  else navigate("/agencies");
                }}
                data-testid="button-back"
              >
                <ChevronLeft className="size-4 mr-1" />
                {step === 1 ? "Back to Agencies" : "Back"}
              </Button>
              {step < 5 && (
                <Button
                  onClick={() => setStep(s => s + 1)}
                  disabled={!canAdvance() || loadingServices}
                  data-testid="button-next"
                >
                  Next <ChevronRight className="size-4 ml-1" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
