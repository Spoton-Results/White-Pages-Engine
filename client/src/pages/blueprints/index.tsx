import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Layers, Trash2, MoreHorizontal, Sparkles, CheckCircle, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const PAGE_TYPES = [
  { value: "service_city", label: "Service + City", example: '"Credit Card Processing in Austin, TX"' },
  { value: "state_hub", label: "State Hub", example: '"Merchant Services in Texas"' },
  { value: "city_hub", label: "City Hub", example: '"Business Services in Houston"' },
  { value: "industry_city", label: "Industry + City", example: '"Restaurant Payment Solutions in Chicago"' },
  { value: "problem_intent", label: "Problem Intent", example: '"How to Accept Credit Cards for Small Business"' },
];

const pageTypeColors: Record<string, string> = {
  service_city: "bg-blue-500/10 text-blue-700",
  state_hub: "bg-violet-500/10 text-violet-700",
  city_hub: "bg-emerald-500/10 text-emerald-700",
  industry_city: "bg-orange-500/10 text-orange-700",
  problem_intent: "bg-red-500/10 text-red-700",
};

export default function BlueprintsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedBlueprint, setGeneratedBlueprint] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBulkBp, setShowBulkBp] = useState(false);
  const [bulkPageTypes, setBulkPageTypes] = useState<Set<string>>(new Set());
  const [bulkSvcs, setBulkSvcs] = useState<Set<string>>(new Set());
  const [bulkBpJobId, setBulkBpJobId] = useState<string | null>(null);

  const LS_KEY = "nexus_blueprint_wizard";

  // AI form state — seed from localStorage so Extra Instructions are remembered
  const [aiForm, setAiForm] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      return {
        businessName: saved.businessName || "",
        industry: saved.industry || "",
        serviceName: saved.serviceName || "",
        pageType: saved.pageType || "service_city",
        extraContext: saved.extraContext || "",
      };
    } catch {
      return { businessName: "", industry: "", serviceName: "", pageType: "service_city", extraContext: "" };
    }
  });

  // Persist wizard fields to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(aiForm)); } catch {}
  }, [aiForm]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  // Derived: always resolve to first account unless user explicitly picked one
  const selectedAccount = overrideAccount || (accounts as any[])[0]?.id || "";

  const { data: blueprints = [], isLoading } = useQuery({
    queryKey: ["/api/blueprints", selectedAccount],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/blueprints`),
    enabled: !!selectedAccount,
  });

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: brandProfiles = [] } = useQuery({
    queryKey: ["/api/brand-profiles", selectedAccount],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/brand-profiles`),
    enabled: !!selectedAccount,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccount, "services"],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/services`),
    enabled: !!selectedAccount,
  });

  // Stable primitive dep — avoids infinite loop from new [] refs on every render
  const firstBrandName = (brandProfiles as any[])[0]?.name ?? "";

  // Pre-fill businessName from brand profile (only if not already set)
  useEffect(() => {
    if (firstBrandName) setAiForm(p => ({ ...p, businessName: p.businessName || firstBrandName }));
  }, [firstBrandName]);

  // Pre-fill industry from account name (only if not already set by user)
  useEffect(() => {
    if (accounts.length > 0 && selectedAccount) {
      const acc = accounts.find((a: any) => a.id === selectedAccount);
      if (acc) setAiForm(p => ({ ...p, industry: p.industry || acc.name || "" }));
    }
  }, [selectedAccount]);

  const generateMutation = useMutation({
    mutationFn: (payload: typeof aiForm) => api.post<any>("/api/ai/generate-blueprint", payload),
    onSuccess: (data) => {
      setGeneratedBlueprint(data);
      setShowCreate(false);
      setShowPreview(true);
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const bulkBpJobQ = useQuery<any>({
    queryKey: ["blueprint-bulk-job", bulkBpJobId],
    queryFn: () => api.get<any>(`/api/accounts/${selectedAccount}/blueprints/bulk-job/${bulkBpJobId}`),
    enabled: !!bulkBpJobId,
    refetchInterval: (q: any) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 1500;
    },
  });

  const bulkBpJob = bulkBpJobQ.data as any;
  const bulkBpDone = bulkBpJob?.status === "done" || bulkBpJob?.status === "error";

  const submitBulkBp = async () => {
    const resp = await api.post<any>(`/api/accounts/${selectedAccount}/blueprints/bulk-generate`, {
      pageTypes: [...bulkPageTypes],
      services: bulkSvcs.size > 0 ? [...bulkSvcs] : [""],
    });
    if (resp.jobId) setBulkBpJobId(resp.jobId);
    else toast({ title: "Error starting job", variant: "destructive" });
  };

  const closeBulkBp = () => { setShowBulkBp(false); setBulkBpJobId(null); setBulkPageTypes(new Set()); setBulkSvcs(new Set()); };

  const accountWebsites = websites.filter((w: any) => w.accountId === selectedAccount);

  const saveMutation = useMutation({
    mutationFn: (blueprint: any) => api.post(`/api/accounts/${selectedAccount}/blueprints`, {
      ...blueprint,
      websiteId: accountWebsites[0]?.id,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/blueprints"] });
      setShowPreview(false);
      setGeneratedBlueprint(null);
      toast({ title: "Blueprint saved!", description: "Ready to use in generation jobs." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/blueprints/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/blueprints"] });
      toast({ title: "Blueprint deleted" });
    },
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blueprints</h1>
            <p className="text-muted-foreground text-sm mt-0.5">AI-generated page templates — define once, generate thousands.</p>
          </div>
          {selectedAccount && (
            <div className="flex gap-2">
              <Button
                className="gap-2"
                size="sm"
                variant="outline"
                onClick={() => setShowBulkBp(true)}
                data-testid="button-bulk-blueprints"
              >
                <Zap className="size-4" />Bulk Generate
              </Button>
              <Button
                className="gap-2"
                size="sm"
                onClick={() => setShowCreate(true)}
                data-testid="button-new-blueprint"
              >
                <Sparkles className="size-4" />Generate with AI
              </Button>
            </div>
          )}
        </div>

        {/* Account selector — hidden if only one account */}
        {accounts.length > 1 && (
          <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
            <Select onValueChange={setOverrideAccount} value={selectedAccount}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Layers className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage its blueprints</p>
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : blueprints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-4">
            <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="size-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">No blueprints yet</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                Click "Generate with AI" and describe your page type — Claude will build the full template automatically.
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Sparkles className="size-4" />Generate with AI
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {blueprints.map((bp: any) => (
              <Card key={bp.id} className="hover:border-primary/40 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${pageTypeColors[bp.pageType] || "bg-muted"}`}>
                          {PAGE_TYPES.find(p => p.value === bp.pageType)?.label || bp.pageType}
                        </span>
                        {bp.isActive && <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700">Active</Badge>}
                      </div>
                      <CardTitle className="text-sm font-semibold mt-1">{bp.name}</CardTitle>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-7 w-7 p-0 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="gap-2 text-destructive cursor-pointer"
                          onClick={() => confirm("Delete this blueprint?") && remove.mutate(bp.id)}
                        >
                          <Trash2 className="size-4" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="font-mono bg-muted rounded px-2 py-1.5 text-xs text-muted-foreground truncate">
                    {bp.titleTemplate}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Min words: <span className="font-medium text-foreground">{bp.requiredWordCount}</span></span>
                    <span>Min score: <span className="font-medium text-foreground">{(parseFloat(bp.minPublishScore) * 100).toFixed(0)}%</span></span>
                    <span>Sections: <span className="font-medium text-foreground">{(bp.sections as any[])?.length || 0}</span></span>
                  </div>
                  {/* Expandable sections */}
                  {(bp.sections as any[])?.length > 0 && (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                      onClick={() => setExpandedId(expandedId === bp.id ? null : bp.id)}
                    >
                      {expandedId === bp.id ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      {expandedId === bp.id ? "Hide" : "Show"} sections
                    </button>
                  )}
                  {expandedId === bp.id && (
                    <div className="space-y-1 pt-1">
                      {(bp.sections as any[]).map((s: any, i: number) => (
                        <div key={i} className="text-xs bg-muted/60 rounded px-2 py-1">
                          <span className="font-medium">{s.name}</span>
                          {s.description && <span className="text-muted-foreground"> — {s.description}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* AI Generation Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              Generate Blueprint with AI
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tell Claude about your business and what type of page you want — it will build the full template, sections, and SEO fields automatically.
            </p>

            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                placeholder="SpotOn Results"
                value={aiForm.businessName}
                onChange={e => setAiForm(p => ({ ...p, businessName: e.target.value }))}
                data-testid="input-business-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Industry / Business Type</Label>
              <Input
                placeholder="Merchant services, payment processing"
                value={aiForm.industry}
                onChange={e => setAiForm(p => ({ ...p, industry: e.target.value }))}
                data-testid="input-industry"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Specific Service <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              {services.length > 0 ? (
                <Select
                  value={aiForm.serviceName || "__all__"}
                  onValueChange={v => setAiForm(p => ({ ...p, serviceName: v === "__all__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Pick a service or leave blank for general" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All services (general)</SelectItem>
                    {services.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. Credit Card Processing"
                  value={aiForm.serviceName}
                  onChange={e => setAiForm(p => ({ ...p, serviceName: e.target.value }))}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Page Type</Label>
              <Select value={aiForm.pageType} onValueChange={v => setAiForm(p => ({ ...p, pageType: v }))}>
                <SelectTrigger data-testid="select-page-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_TYPES.map(pt => (
                    <SelectItem key={pt.value} value={pt.value}>
                      <div>
                        <div className="font-medium">{pt.label}</div>
                        <div className="text-xs text-muted-foreground">{pt.example}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Extra Instructions <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Textarea
                placeholder="e.g. Focus on restaurants and retail stores. Include a section about same-day setup. Emphasize low rates."
                rows={3}
                value={aiForm.extraContext}
                onChange={e => setAiForm(p => ({ ...p, extraContext: e.target.value }))}
                data-testid="input-extra-context"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => generateMutation.mutate(aiForm)}
              disabled={generateMutation.isPending || !aiForm.businessName || !aiForm.industry}
              className="gap-2"
              data-testid="button-generate-blueprint"
            >
              <Sparkles className="size-4" />
              {generateMutation.isPending ? "Generating…" : "Generate Blueprint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview & Save Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="size-5 text-emerald-500" />
              Blueprint Ready — Review & Save
            </DialogTitle>
          </DialogHeader>

          {generatedBlueprint && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Blueprint Name</Label>
                <Input
                  value={generatedBlueprint.name}
                  onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Title Template</Label>
                <Input
                  value={generatedBlueprint.titleTemplate}
                  onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, titleTemplate: e.target.value }))}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>H1 Template</Label>
                <Input
                  value={generatedBlueprint.h1Template}
                  onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, h1Template: e.target.value }))}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Meta Description Template</Label>
                <Textarea
                  rows={2}
                  value={generatedBlueprint.metaDescTemplate}
                  onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, metaDescTemplate: e.target.value }))}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>URL Slug Template</Label>
                <Input
                  value={generatedBlueprint.slugTemplate}
                  onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, slugTemplate: e.target.value }))}
                  className="font-mono text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Min Word Count</Label>
                  <Input
                    type="number"
                    value={generatedBlueprint.requiredWordCount}
                    onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, requiredWordCount: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Min Quality Score</Label>
                  <Input
                    value={generatedBlueprint.minPublishScore}
                    onChange={e => setGeneratedBlueprint((p: any) => ({ ...p, minPublishScore: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Sections ({generatedBlueprint.sections?.length})</Label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-md p-2">
                  {generatedBlueprint.sections?.map((s: any, i: number) => (
                    <div key={i} className="bg-muted/50 rounded px-2 py-1.5 text-sm">
                      <div className="font-medium text-xs">{s.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                You can edit any field above before saving. Changes are reflected immediately in future generation jobs.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPreview(false); setShowCreate(true); }}>
              ← Regenerate
            </Button>
            <Button
              onClick={() => saveMutation.mutate(generatedBlueprint)}
              disabled={saveMutation.isPending}
              className="gap-2"
              data-testid="button-save-blueprint"
            >
              <CheckCircle className="size-4" />
              {saveMutation.isPending ? "Saving…" : "Save Blueprint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix 2 — Bulk Blueprint Generation Dialog */}
      <Dialog open={showBulkBp} onOpenChange={v => { if (!v) closeBulkBp(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Generate Blueprints</DialogTitle>
          </DialogHeader>
          {!bulkBpJobId ? (
            <div className="flex flex-col gap-4 py-2">
              <div>
                <Label className="mb-2 block">Page Types (select one or more)</Label>
                <div className="flex flex-col gap-1.5 border rounded-lg p-3 max-h-48 overflow-auto">
                  {PAGE_TYPES.map(pt => (
                    <label key={pt.value} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={bulkPageTypes.has(pt.value)}
                        onChange={() => { const n = new Set(bulkPageTypes); if (n.has(pt.value)) n.delete(pt.value); else n.add(pt.value); setBulkPageTypes(n); }} />
                      <span className="text-sm font-medium">{pt.label}</span>
                      <span className="text-xs text-muted-foreground ml-1">{pt.example}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Services <span className="text-muted-foreground font-normal">(optional — generates per-service blueprints)</span></Label>
                  <button className="text-xs text-primary" onClick={() => setBulkSvcs(bulkSvcs.size === (services as any[]).length ? new Set() : new Set((services as any[]).map((s: any) => s.name)))}>
                    {bulkSvcs.size === (services as any[]).length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="border rounded-lg p-2 max-h-40 overflow-auto flex flex-col gap-1">
                  {(services as any[]).length === 0 ? (
                    <span className="text-sm text-muted-foreground p-2">No services found</span>
                  ) : (services as any[]).map((s: any) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={bulkSvcs.has(s.name)}
                        onChange={() => { const n = new Set(bulkSvcs); if (n.has(s.name)) n.delete(s.name); else n.add(s.name); setBulkSvcs(n); }} />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="text-sm text-muted-foreground bg-muted/40 rounded p-2">
                Will generate <strong>{bulkPageTypes.size * Math.max(bulkSvcs.size, 1)}</strong> blueprint(s)
                ({bulkPageTypes.size} type{bulkPageTypes.size !== 1 ? "s" : ""} × {Math.max(bulkSvcs.size, 1)} service{Math.max(bulkSvcs.size, 1) !== 1 ? "s" : ""})
              </div>
            </div>
          ) : (
            <div className="py-4">
              <div className="text-sm font-medium mb-2">{bulkBpDone ? (bulkBpJob?.status === "error" ? "Job failed" : "Done!") : "Generating blueprints…"}</div>
              <div className="h-3 bg-muted rounded overflow-hidden mb-2">
                <div className="h-full bg-primary transition-all" style={{ width: `${bulkBpJob ? Math.round((bulkBpJob.done / Math.max(bulkBpJob.total, 1)) * 100) : 0}%` }} />
              </div>
              <div className="text-xs text-muted-foreground">
                {bulkBpJob ? `${bulkBpJob.done} / ${bulkBpJob.total} processed — ${bulkBpJob.created ?? 0} created` : "Starting…"}
              </div>
            </div>
          )}
          <DialogFooter>
            {!bulkBpJobId ? (
              <>
                <Button variant="outline" onClick={closeBulkBp}>Cancel</Button>
                <Button onClick={submitBulkBp} disabled={bulkPageTypes.size === 0} data-testid="btn-bulk-bp-submit">
                  Generate {bulkPageTypes.size * Math.max(bulkSvcs.size, 1)} Blueprint{bulkPageTypes.size * Math.max(bulkSvcs.size, 1) !== 1 ? "s" : ""}
                </Button>
              </>
            ) : bulkBpDone ? (
              <Button onClick={() => { closeBulkBp(); qc.invalidateQueries({ queryKey: ["/api/blueprints"] }); }}>Close</Button>
            ) : (
              <Button variant="outline" disabled>Running…</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
