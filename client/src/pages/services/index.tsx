import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Wrench, Trash2, Sparkles, Globe, Check, X, BookOpen, CheckCircle2, Loader2, AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function ServicesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [suggestedServices, setSuggestedServices] = useState<any[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  const [aiForm, setAiForm] = useState({
    businessName: "",
    websiteUrl: "",
    industry: "",
  });

  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  // Derived: always resolve to first account unless user explicitly picked one
  const selectedAccount = overrideAccount || (accounts as any[])[0]?.id || "";

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["/api/services", selectedAccount],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/services`),
    enabled: !!selectedAccount,
  });

  const { data: brandProfiles = [] } = useQuery({
    queryKey: ["/api/brand-profiles", selectedAccount],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccount}/brand-profiles`),
    enabled: !!selectedAccount,
  });

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  // Stable primitives — avoids infinite loop when brandProfiles/websites return new [] refs each render
  const firstBrandName = (brandProfiles as any[])[0]?.name ?? "";
  const accountDomain = (websites as any[]).find((w: any) => w.accountId === selectedAccount)?.domain ?? "";

  // Pre-fill AI form from brand profile / website
  useEffect(() => {
    if (firstBrandName) setAiForm(p => ({ ...p, businessName: firstBrandName || p.businessName }));
    if (accountDomain) setAiForm(p => ({ ...p, websiteUrl: `https://${accountDomain}` }));
  }, [firstBrandName, accountDomain, selectedAccount]);

  // ── Variation Banks tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"services" | "variation-banks">("services");
  const [bankWebsiteId, setBankWebsiteId] = useState<string>("");

  const accountWebsites = (websites as any[]).filter((w: any) => w.accountId === selectedAccount);

  // Auto-select the first account website when switching accounts
  const firstWebsiteId = accountWebsites[0]?.id ?? "";
  useEffect(() => {
    if (firstWebsiteId) setBankWebsiteId(firstWebsiteId);
  }, [firstWebsiteId]);

  const bankServicesQ = useQuery<string[]>({
    queryKey: ["/api/websites", bankWebsiteId, "bank-services"],
    queryFn: () => api.get<string[]>(`/api/websites/${bankWebsiteId}/bank-services`),
    enabled: !!bankWebsiteId,
  });

  const bankContextQ = useQuery<any>({
    queryKey: ["/api/websites", bankWebsiteId, "context"],
    queryFn: () => api.get<any>(`/api/websites/${bankWebsiteId}/context`),
    enabled: !!bankWebsiteId,
  });

  const bankSet = new Set<string>(bankServicesQ.data ?? []);

  const writeBankMut = useMutation({
    mutationFn: ({ service }: { service: string }) =>
      api.post<any>(`/api/websites/${bankWebsiteId}/variation-banks/write`, { service }),
    onSuccess: (data: any, { service }) => {
      const ctx = data?.context;
      const desc = ctx?.brand || ctx?.industry
        ? `Written using ${[ctx.brand, ctx.industry].filter(Boolean).join(" · ")} context`
        : `Bank ready for "${service}"`;
      toast({ title: `Bank written for "${service}"`, description: desc });
      qc.invalidateQueries({ queryKey: ["/api/websites", bankWebsiteId, "bank-services"] });
      qc.invalidateQueries({ queryKey: ["/api/websites", bankWebsiteId, "variation-services"] });
    },
    onError: (err: any) => toast({
      title: "Write failed — please try again",
      description: err.message?.includes("timed out")
        ? "The AI API took too long. Try again in a moment — it usually completes on retry."
        : (err.message ?? "Claude API error"),
      variant: "destructive",
    }),
  });

  const writeAllUnbankedMut = useMutation({
    mutationFn: async () => {
      const unbanked = (services as any[]).filter((s: any) => !bankSet.has(s.name));
      for (const svc of unbanked) {
        await api.post<any>(`/api/websites/${bankWebsiteId}/variation-banks/write`, { service: svc.name });
      }
    },
    onSuccess: () => {
      toast({ title: "All banks written!", description: "All services now have variation banks." });
      qc.invalidateQueries({ queryKey: ["/api/websites", bankWebsiteId, "bank-services"] });
      qc.invalidateQueries({ queryKey: ["/api/websites", bankWebsiteId, "variation-services"] });
    },
    onError: (err: any) => toast({ title: "Write failed", description: err.message, variant: "destructive" }),
  });

  const suggestMutation = useMutation({
    mutationFn: () => api.post<any[]>("/api/ai/suggest-services", {
      ...aiForm,
      existingServices: (services as any[]).map((s: any) => s.name),
    }),
    onSuccess: (data) => {
      setSuggestedServices(data);
      setSelectedSuggestions(new Set(data.map((_: any, i: number) => i)));
      setShowAI(false);
      setShowReview(true);
    },
    onError: (err: any) => toast({ title: "Suggestion failed", description: err.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/services`, {
      ...data,
      keywords: data.keywords ? data.keywords.split(",").map((k: string) => k.trim()) : [],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/services"] });
      setShowCreate(false);
      reset();
      toast({ title: "Service added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async () => {
      const toAdd = suggestedServices.filter((_, i) => selectedSuggestions.has(i));
      for (const svc of toAdd) {
        await api.post(`/api/accounts/${selectedAccount}/services`, svc);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/services"] });
      setShowReview(false);
      setSuggestedServices([]);
      toast({ title: `${selectedSuggestions.size} services added!`, description: "Ready to use in generation jobs." });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/services/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/services"] });
      toast({ title: "Service deleted" });
    },
  });

  const toggleSuggestion = (i: number) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Services</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage service offerings and their content banks for page generation.</p>
          </div>
        </div>

        {(accounts as any[]).length > 1 && (
          <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
            <Select onValueChange={v => { setOverrideAccount(v); }} value={selectedAccount}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {(accounts as any[]).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedAccount && <span className="text-sm text-muted-foreground">{(services as any[]).length} services</span>}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "services" | "variation-banks")} className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
              <TabsTrigger value="variation-banks" data-testid="tab-variation-banks">Variation Banks</TabsTrigger>
            </TabsList>
            {activeTab === "services" && selectedAccount && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowAI(true)} data-testid="button-suggest-services">
                  <Sparkles className="size-4" />Suggest with AI
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)} data-testid="button-add-service">
                  <Plus className="size-4" />Add Service
                </Button>
              </div>
            )}
          </div>

          {/* ── Services Tab ────────────────────────────────────────────────── */}
          <TabsContent value="services" className="space-y-4 mt-0">
            {!selectedAccount ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                {accountsLoading ? (
                  <>
                    <Skeleton className="size-12 rounded-full" />
                    <Skeleton className="h-4 w-48" />
                  </>
                ) : (
                  <>
                    <Wrench className="size-12 text-muted-foreground/30" />
                    <p className="text-muted-foreground">Select an account to manage services</p>
                  </>
                )}
              </div>
            ) : (services as any[]).length === 0 && !isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-4">
                <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="size-8 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">No services yet</h3>
                  <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                    Let AI suggest all your services at once based on your website or industry.
                  </p>
                </div>
                <Button onClick={() => setShowAI(true)} className="gap-2">
                  <Sparkles className="size-4" />Suggest with AI
                </Button>
              </div>
            ) : (
              <div className="bg-card rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Slug</TableHead>
                      <TableHead className="hidden md:table-cell">Keywords</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 4 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (services as any[]).map((svc: any) => (
                      <TableRow key={svc.id}>
                        <TableCell className="font-medium">
                          <div>{svc.name}</div>
                          <div className="text-xs text-muted-foreground sm:hidden font-mono">{svc.slug}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground hidden sm:table-cell">{svc.slug}</TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                          {svc.keywords?.slice(0, 3).join(", ")}{svc.keywords?.length > 3 ? ` +${svc.keywords.length - 3}` : ""}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => confirm("Delete service?") && remove.mutate(svc.id)}
                            data-testid={`button-delete-service-${svc.id}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Variation Banks Tab ─────────────────────────────────────────── */}
          <TabsContent value="variation-banks" className="space-y-4 mt-0">
            {!selectedAccount ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <Wrench className="size-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">Select an account to manage variation banks</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Website selector */}
                {accountWebsites.length > 1 && (
                  <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
                    <Select onValueChange={setBankWebsiteId} value={bankWebsiteId}>
                      <SelectTrigger className="w-64" data-testid="select-bank-website">
                        <SelectValue placeholder="Select website" />
                      </SelectTrigger>
                      <SelectContent>
                        {accountWebsites.map((w: any) => (
                          <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">
                      {bankServicesQ.data?.length ?? 0} of {(services as any[]).length} services banked
                    </span>
                  </div>
                )}

                {!bankWebsiteId ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                    <Wrench className="size-10 text-muted-foreground/30" />
                    <p className="text-muted-foreground text-sm">No website found for this account</p>
                  </div>
                ) : (
                  <>
                    {/* AI context indicator */}
                    {bankContextQ.data?.brand || bankContextQ.data?.industry ? (
                      <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-md bg-blue-50 border border-blue-200 text-xs">
                        <span className="text-blue-700 font-medium">AI context:</span>
                        {bankContextQ.data?.brand?.name && (
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{bankContextQ.data.brand.name}</span>
                        )}
                        {bankContextQ.data?.industry?.name && (
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{bankContextQ.data.industry.name}</span>
                        )}
                        {bankContextQ.data?.brand?.voiceAndTone && (
                          <span className="text-blue-600 italic truncate max-w-[220px]">{bankContextQ.data.brand.voiceAndTone}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
                        <Info className="size-3.5 shrink-0" />
                        No brand profile or industry set — content will be generic. Add them for better results.
                      </div>
                    )}

                    {/* Write All Unbanked button */}
                    {(services as any[]).some((s: any) => !bankSet.has(s.name)) && (
                      <div className="flex items-center gap-3">
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => writeAllUnbankedMut.mutate()}
                          disabled={writeAllUnbankedMut.isPending || writeBankMut.isPending}
                          data-testid="button-write-all-banks"
                        >
                          {writeAllUnbankedMut.isPending
                            ? <><Loader2 className="size-4 animate-spin" /> Writing all...</>
                            : <><BookOpen className="size-4" /> Write All Unbanked</>}
                        </Button>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Info className="size-3" />
                          5 Claude API calls per service (paid once, generates instantly after)
                        </p>
                      </div>
                    )}

                    {/* Service bank list */}
                    {(services as any[]).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg">
                        No services yet — add services in the Services tab first.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(services as any[]).map((svc: any) => {
                          const hasBanks = bankSet.has(svc.name);
                          const isWriting = (writeBankMut.isPending || writeAllUnbankedMut.isPending) && writeBankMut.variables?.service === svc.name;
                          return (
                            <div
                              key={svc.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${hasBanks ? "bg-green-50 border-green-200" : "bg-card"}`}
                              data-testid={`row-bank-${svc.id}`}
                            >
                              <div className="shrink-0">
                                {hasBanks
                                  ? <CheckCircle2 className="size-5 text-green-600" />
                                  : <AlertCircle className="size-5 text-amber-400" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${hasBanks ? "text-green-800" : ""}`}>{svc.name}</p>
                                <p className={`text-xs ${hasBanks ? "text-green-600" : "text-muted-foreground"}`}>
                                  {hasBanks ? "Banks ready — will generate instantly" : "Needs bank written before generating"}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant={hasBanks ? "ghost" : "default"}
                                className={`shrink-0 gap-1.5 h-7 text-xs ${hasBanks ? "text-green-700 hover:text-green-900" : ""}`}
                                onClick={() => writeBankMut.mutate({ service: svc.name })}
                                disabled={writeBankMut.isPending || writeAllUnbankedMut.isPending}
                                data-testid={`button-bank-${svc.id}`}
                              >
                                {isWriting
                                  ? <><Loader2 className="size-3 animate-spin" /> Writing...</>
                                  : hasBanks
                                    ? "Rewrite"
                                    : <><BookOpen className="size-3" /> Write Bank</>}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* AI Suggest Dialog */}
      <Dialog open={showAI} onOpenChange={setShowAI}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              AI Service Suggestions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tell Claude about your business and it will generate a complete list of services with SEO keywords — no manual entry needed.
            </p>

            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                placeholder="SpotOn Results"
                value={aiForm.businessName}
                onChange={e => setAiForm(p => ({ ...p, businessName: e.target.value }))}
                data-testid="input-ai-business-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Globe className="size-3.5" />
                Website URL <span className="text-muted-foreground font-normal text-xs">(optional — helps Claude understand your business)</span>
              </Label>
              <Input
                placeholder="https://yourbusiness.com"
                value={aiForm.websiteUrl}
                onChange={e => setAiForm(p => ({ ...p, websiteUrl: e.target.value }))}
                data-testid="input-website-url"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Industry / What You Do</Label>
              <Textarea
                placeholder="e.g. Merchant services and payment processing for small businesses. We help retail stores, restaurants, and service businesses accept credit cards with no contracts and low rates."
                rows={3}
                value={aiForm.industry}
                onChange={e => setAiForm(p => ({ ...p, industry: e.target.value }))}
                data-testid="input-ai-industry"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAI(false)}>Cancel</Button>
            <Button
              onClick={() => suggestMutation.mutate()}
              disabled={suggestMutation.isPending || !aiForm.businessName || !aiForm.industry}
              className="gap-2"
              data-testid="button-generate-services"
            >
              <Sparkles className="size-4" />
              {suggestMutation.isPending ? "Thinking…" : "Suggest Services"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review & Import Dialog */}
      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="size-5 text-emerald-500" />
              {suggestedServices.length} Services Suggested — Pick What You Want
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-3">
              <span>{selectedSuggestions.size} selected</span>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  if (selectedSuggestions.size === suggestedServices.length) {
                    setSelectedSuggestions(new Set());
                  } else {
                    setSelectedSuggestions(new Set(suggestedServices.map((_, i) => i)));
                  }
                }}
              >
                {selectedSuggestions.size === suggestedServices.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            {suggestedServices.map((svc, i) => (
              <div
                key={i}
                onClick={() => toggleSuggestion(i)}
                className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                  selectedSuggestions.has(i)
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card opacity-60"
                }`}
                data-testid={`suggestion-${i}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{svc.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{svc.slug}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{svc.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {svc.keywords?.map((kw: string, ki: number) => (
                        <Badge key={ki} variant="secondary" className="text-xs py-0">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className={`size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    selectedSuggestions.has(i) ? "bg-primary text-primary-foreground" : "border border-muted-foreground/30"
                  }`}>
                    {selectedSuggestions.has(i) && <Check className="size-3" />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowReview(false); setShowAI(true); }}>
              ← Regenerate
            </Button>
            <Button
              onClick={() => bulkCreateMutation.mutate()}
              disabled={bulkCreateMutation.isPending || selectedSuggestions.size === 0}
              className="gap-2"
              data-testid="button-import-services"
            >
              <Plus className="size-4" />
              {bulkCreateMutation.isPending
                ? "Importing…"
                : `Import ${selectedSuggestions.size} Service${selectedSuggestions.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Add Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Service Manually</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Service Name</Label>
              <Input placeholder="Credit Card Processing" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="credit-card-processing" {...register("slug", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Service description..." {...register("description")} />
            </div>
            <div className="space-y-1.5">
              <Label>Keywords (comma separated)</Label>
              <Input placeholder="credit card processing, merchant services, payment processing" {...register("keywords")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
