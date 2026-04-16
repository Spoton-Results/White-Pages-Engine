import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Play, Square, Plus, RefreshCw, Zap, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

const emptyForm = { accountId: "", websiteId: "", blueprintId: "", jobName: "", locationIds: [] as string[], serviceIds: [] as string[], industryIds: [] as string[] };

export default function JobsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const websiteIdFilter = params.get("websiteId");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [locFilter, setLocFilter] = useState("");
  const [locTypeFilter, setLocTypeFilter] = useState<"all" | "state" | "city">("state");
  const [topCitiesLimit, setTopCitiesLimit] = useState<number | "all" | null>(null);
  const [cityTierFilter, setCityTierFilter] = useState<number | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [rescoring, setRescoring] = useState(false);

  // Guards so auto-select fires once per dialog session and never overrides explicit user edits
  const didAutoSelectServices = useRef(false);
  const didAutoSelectLocations = useRef(false);

  const toggleErrors = (jobId: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const { data: jobs = [], isLoading, isFetching: jobsFetching } = useQuery({
    queryKey: ["/api/jobs", websiteIdFilter],
    queryFn: () => api.get<any[]>("/api/jobs"),
    refetchInterval: 5000,
  });

  const { data: systemStatus } = useQuery({
    queryKey: ["/api/system/status"],
    queryFn: () => api.get<any>("/api/system/status"),
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const selectedAccountId = form.accountId;

  const { data: blueprints = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "blueprints"],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccountId}/blueprints`),
    enabled: !!selectedAccountId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "locations"],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccountId}/locations`),
    enabled: !!selectedAccountId,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "services"],
    queryFn: () => api.get<any[]>(`/api/accounts/${selectedAccountId}/services`),
    enabled: !!selectedAccountId,
  });

  // ── Auto-select account if only one ────────────────────────────
  useEffect(() => {
    if (showCreate && accounts.length === 1 && !form.accountId) {
      setForm(p => ({ ...p, accountId: accounts[0].id }));
    }
  }, [showCreate, accounts]);

  // ── Auto-select website if only one for this account ────────────
  const accountWebsites = websites.filter((w: any) => w.accountId === selectedAccountId);
  useEffect(() => {
    if (selectedAccountId && accountWebsites.length === 1 && !form.websiteId) {
      setForm(p => ({ ...p, websiteId: accountWebsites[0].id }));
    }
  }, [selectedAccountId, accountWebsites.length]);

  // ── Auto-select blueprint if only one ──────────────────────────
  useEffect(() => {
    if (blueprints.length === 1 && !form.blueprintId) {
      setForm(p => ({ ...p, blueprintId: blueprints[0].id }));
    }
  }, [blueprints.length]);

  // ── Auto-select ALL services when they load (once per dialog session) ──────
  useEffect(() => {
    if (services.length > 0 && !didAutoSelectServices.current) {
      didAutoSelectServices.current = true;
      setForm(p => ({ ...p, serviceIds: services.map((s: any) => s.id) }));
    }
  }, [services.length]);

  // ── Auto-select all STATES when locations load (once per dialog session) ────
  useEffect(() => {
    if (locations.length > 0 && !didAutoSelectLocations.current) {
      didAutoSelectLocations.current = true;
      const stateIds = locations.filter((l: any) => l.type === "state").map((l: any) => l.id);
      setForm(p => ({ ...p, locationIds: stateIds }));
    }
  }, [locations.length]);

  const createJob = useMutation({
    mutationFn: (data: any) => api.post("/api/jobs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setShowCreate(false);
      setForm({ ...emptyForm });
      setLocFilter("");
      setLocTypeFilter("state");
      toast({ title: "Generation job started", description: "Pages are being generated in the background." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/api/jobs/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job cancelled" });
    },
  });

  const deleteJob = useMutation({
    mutationFn: (id: string) => api.delete(`/api/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Cannot delete", description: err.message, variant: "destructive" });
    },
  });

  const clearCompleted = useMutation({
    mutationFn: () => api.delete<{ deleted: number }>("/api/jobs/completed"),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedJobs(new Set());
      toast({ title: `Cleared ${data.deleted} job(s)` });
    },
  });

  const deleteSelected = useMutation({
    mutationFn: (ids: string[]) => api.post<{ deleted: number }>("/api/jobs/delete-batch", { ids }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedJobs(new Set());
      toast({ title: `Removed ${data.deleted} job(s)` });
    },
  });

  const isDeletable = (status: string) => ["completed", "cancelled", "failed", "error", "pending"].includes(status);
  const finishedJobs = jobs.filter((j: any) => isDeletable(j.status));

  const visibleJobs = useMemo(() => {
    return jobs.filter((j: any) => {
      const matchStatus = statusFilter === "all" || j.status === statusFilter;
      const matchSite = siteFilter === "all" || j.websiteId === siteFilter;
      return matchStatus && matchSite;
    });
  }, [jobs, statusFilter, siteFilter]);

  const toggleJobSelect = (id: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAllFinished = () => {
    setSelectedJobs(new Set(finishedJobs.map((j: any) => j.id)));
  };

  const toggleSelection = (field: keyof typeof emptyForm, id: string) => {
    setForm(prev => {
      const arr = (prev[field] as string[]) || [];
      return { ...prev, [field]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
    });
  };

  const selectAll = (field: keyof typeof emptyForm, ids: string[]) =>
    setForm(p => ({ ...p, [field]: ids }));
  const selectNone = (field: keyof typeof emptyForm) =>
    setForm(p => ({ ...p, [field]: [] }));

  const filteredLocations = (() => {
    const base = (locations as any[]).filter((loc: any) => {
      const matchType = locTypeFilter === "all" || loc.type === locTypeFilter;
      const matchSearch = !locFilter || loc.name.toLowerCase().includes(locFilter.toLowerCase()) || (loc.stateCode || "").toLowerCase().includes(locFilter.toLowerCase());
      return matchType && matchSearch;
    });
    if (locTypeFilter === "city" && (topCitiesLimit !== null || cityTierFilter !== null)) {
      return [...base].sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0));
    }
    return base;
  })();

  const selectedLocSet = useMemo(() => new Set(form.locationIds), [form.locationIds]);

  const JOBS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const cityLocGroups = useMemo(() => {
    if (locTypeFilter !== "city") return {} as Record<string, any[]>;
    const groups: Record<string, any[]> = {};
    filteredLocations.forEach((loc: any) => {
      const letter = loc.name?.[0]?.toUpperCase() ?? "#";
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(loc);
    });
    return groups;
  }, [filteredLocations, locTypeFilter]);

  const cityLocAvailLetters = useMemo(() => new Set(Object.keys(cityLocGroups)), [cityLocGroups]);

  function isCityLocLetterFull(letter: string): boolean {
    return (cityLocGroups[letter] ?? []).every((loc: any) => selectedLocSet.has(loc.id));
  }

  function isCityLocLetterPartial(letter: string): boolean {
    const g: any[] = cityLocGroups[letter] ?? [];
    return g.some((loc: any) => selectedLocSet.has(loc.id)) && !isCityLocLetterFull(letter);
  }

  function toggleCityLocLetter(letter: string): void {
    const g: any[] = cityLocGroups[letter] ?? [];
    if (!g.length) return;
    const allSel = isCityLocLetterFull(letter);
    setForm(prev => {
      const ids = new Set(prev.locationIds);
      g.forEach((loc: any) => (allSel ? ids.delete(loc.id) : ids.add(loc.id)));
      return { ...prev, locationIds: Array.from(ids) };
    });
  }

  function applyTopCitiesJobs(v: string) {
    setCityTierFilter(null);
    const cityLocs = [...(locations as any[]).filter((l: any) => l.type === "city")]
      .sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0));
    const selected = v === "all" ? cityLocs : cityLocs.slice(0, Number(v));
    setTopCitiesLimit(v === "all" ? "all" : Number(v));
    const nonCityIds = form.locationIds.filter(id => (locations as any[]).find((l: any) => l.id === id && l.type !== "city"));
    setForm(p => ({ ...p, locationIds: [...nonCityIds, ...selected.map((l: any) => l.id)] }));
  }

  function applyTierFilterJobs(tier: number) {
    const newTier = cityTierFilter === tier ? null : tier;
    setCityTierFilter(newTier);
    setTopCitiesLimit(null);
    const nonCityIds = form.locationIds.filter(id => (locations as any[]).find((l: any) => l.id === id && l.type !== "city"));
    if (newTier === null) {
      setForm(p => ({ ...p, locationIds: nonCityIds }));
      return;
    }
    const selected = (locations as any[]).filter((l: any) => l.type === "city" && l.cityTier === newTier);
    setForm(p => ({ ...p, locationIds: [...nonCityIds, ...selected.map((l: any) => l.id)] }));
  }

  const totalPages = form.locationIds.length * form.serviceIds.length;

  const websiteById = new Map(websites.map((w: any) => [w.id, w]));
  const accountById = new Map(accounts.map((a: any) => [a.id, a]));

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="size-4 text-emerald-500" />;
    if (status === "failed") return <XCircle className="size-4 text-destructive" />;
    if (status === "running") return <Play className="size-4 text-blue-500" />;
    return <Clock className="size-4 text-muted-foreground" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Generation Jobs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Create and monitor AI page generation workflows.</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {selectedJobs.size > 0 && (
              <Button variant="destructive" size="sm" onClick={() => deleteSelected.mutate([...selectedJobs])} data-testid="button-delete-selected">
                <Trash2 className="size-4 mr-2" />Delete {selectedJobs.size} selected
              </Button>
            )}
            {finishedJobs.length > 0 && selectedJobs.size === 0 && (
              <Button variant="outline" size="sm" className="text-muted-foreground" onClick={selectAllFinished} data-testid="button-select-all">
                <CheckCircle className="size-4 mr-2" />Select all finished ({finishedJobs.length})
              </Button>
            )}
            {selectedJobs.size > 0 && (
              <Button variant="outline" size="sm" onClick={() => setSelectedJobs(new Set())} data-testid="button-deselect">
                Deselect
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => qc.refetchQueries({ queryKey: ["/api/jobs"] })} disabled={jobsFetching}>
              <RefreshCw className={`size-4 mr-2 ${jobsFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)} data-testid="button-new-job">
              <Plus className="size-4" />New Job
            </Button>
          </div>
        </div>

        {systemStatus !== undefined && !systemStatus.claudeConfigured && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              ANTHROPIC_API_KEY is not configured. Generation jobs require this key to work.
              Add it in your Replit environment secrets and redeploy.
            </AlertDescription>
          </Alert>
        )}

        {/* Filter bar */}
        {jobs.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-site-filter">
                <SelectValue placeholder="All websites" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All websites</SelectItem>
                {websites.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(statusFilter !== "all" || siteFilter !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs px-2 text-muted-foreground"
                onClick={() => { setStatusFilter("all"); setSiteFilter("all"); }}
                data-testid="button-clear-filters">
                Clear filters
              </Button>
            )}
            {siteFilter !== "all" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={rescoring}
                data-testid="button-rescore-pages"
                onClick={async () => {
                  setRescoring(true);
                  try {
                    await api.post(`/api/websites/${siteFilter}/score-pages`, {});
                    toast({ title: "Re-scoring started", description: "Unscored pages are being scored in the background. Refresh in a few minutes." });
                  } catch {
                    toast({ title: "Failed to start re-scoring", variant: "destructive" });
                  } finally {
                    setRescoring(false);
                  }
                }}
              >
                {rescoring ? <><RefreshCw className="size-3 animate-spin" /> Scoring...</> : <><Zap className="size-3" /> Re-score unscored pages</>}
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {visibleJobs.length} of {jobs.length} job{jobs.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Zap className="size-12 text-muted-foreground/30" />
              <div className="text-center">
                <p className="font-medium">No generation jobs yet</p>
                <p className="text-muted-foreground text-sm mt-1">Create a job to start generating white-pages content with Claude AI.</p>
              </div>
              <Button onClick={() => setShowCreate(true)} data-testid="button-create-first-job">Create First Job</Button>
            </CardContent>
          </Card>
        ) : visibleJobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3">
              <p className="text-muted-foreground text-sm">No jobs match the current filters.</p>
              <Button variant="outline" size="sm" onClick={() => { setStatusFilter("all"); setSiteFilter("all"); }}>Clear filters</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visibleJobs.map((job: any) => (
              <Card key={job.id} data-testid={`card-job-${job.id}`}>
                <CardContent className="p-4 flex items-start gap-3">
                  {isDeletable(job.status) ? (
                    <Checkbox
                      checked={selectedJobs.has(job.id)}
                      onCheckedChange={() => toggleJobSelect(job.id)}
                      className="mt-1"
                      data-testid={`checkbox-job-${job.id}`}
                    />
                  ) : (
                    <div className="mt-0.5">{statusIcon(job.status)}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate">{job.name}</h3>
                      <Badge variant="outline" className={`text-xs shrink-0 ${
                        job.status === "completed" ? "border-emerald-200 text-emerald-700" :
                        job.status === "running" ? "border-blue-200 text-blue-700" :
                        job.status === "failed" ? "border-red-200 text-red-700" : ""
                      }`}>{job.status}</Badge>
                    </div>
                    {job.websiteId && (() => {
                      const site = websiteById.get(job.websiteId);
                      const acct = accountById.get(job.accountId ?? site?.accountId);
                      return (acct?.name || site?.domain) ? (
                        <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-job-context-${job.id}`}>
                          {acct?.name && <span className="font-medium">{acct.name}</span>}
                          {acct?.name && site?.domain && <span className="mx-1">·</span>}
                          {site?.domain && <span>{site.domain}</span>}
                        </p>
                      ) : null;
                    })()}

                    {job.settings && (() => {
                      const s = job.settings as any;
                      const svcCount = s.services?.length ?? 0;
                      const modeLabel = s.mode === "all_states" ? "All 50 states"
                        : s.mode === "specific_states" ? `${s.states?.length ?? 0} state(s): ${(s.states ?? []).slice(0, 8).join(", ")}${(s.states?.length ?? 0) > 8 ? ` +${s.states.length - 8} more` : ""}`
                        : s.mode === "specific_cities" ? `${s.cities?.length ?? 0} city/cities`
                        : "—";
                      const clusterCount = s.clusterCount ?? null;
                      const flags: string[] = [];
                      if (s.overwrite) flags.push("Overwrite");
                      if (s.blueprintId) flags.push("Blueprint");
                      return (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-testid={`text-job-details-${job.id}`}>
                          <span>{svcCount} service(s)</span>
                          {clusterCount !== null && <><span>·</span><span>{clusterCount} cluster(s)</span></>}
                          <span>·</span>
                          <span>{modeLabel}</span>
                          {flags.length > 0 && <><span>·</span><span>{flags.join(", ")}</span></>}
                        </div>
                      );
                    })()}

                    {job.totalPages > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>{Math.min(job.processedPages, job.totalPages)} / {job.totalPages} pages</span>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-600">{Math.min(job.passedPages, job.totalPages)} passed</span>
                            {job.failedPages > 0 && <span className="text-destructive">{job.failedPages} failed</span>}
                            {(() => { const skipped = Math.min(job.processedPages, job.totalPages) - Math.min(job.passedPages, job.totalPages) - (job.failedPages ?? 0); return skipped > 0 ? <span className="text-amber-500">{skipped} skipped</span> : null; })()}
                          </div>
                        </div>
                        <Progress value={Math.min((job.processedPages / job.totalPages) * 100, 100)} className="h-1.5" />
                        {/* Skip reason breakdown */}
                        {(() => {
                          const s = job.settings as any;
                          if (!Array.isArray(s?.progress)) return null;
                          const slugSkipped = s.progress.reduce((sum: number, p: any) => sum + (p.skipped ?? 0), 0);
                          const noBankServices = s.progress.filter((p: any) => p.status === "no-bank").length;
                          const passed = Math.min(job.passedPages, job.totalPages);
                          const processed = Math.min(job.processedPages, job.totalPages);
                          const skipRate = processed > 0 ? (processed - passed) / processed : 0;
                          const isHighSkip = job.status === "completed" && (passed === 0 || skipRate > 0.5) && processed > 0;
                          return (
                            <>
                              {isHighSkip && (
                                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid={`banner-high-skip-${job.id}`}>
                                  <span className="font-semibold">⚠ High skip rate</span> — most pages were not generated. Check skip reasons below. If regenerating existing content, enable <span className="font-semibold">Overwrite existing pages</span> before running again.
                                </div>
                              )}
                              {(slugSkipped > 0 || noBankServices > 0) && (
                                <div className="mt-1.5 space-y-0.5" data-testid={`text-skip-breakdown-${job.id}`}>
                                  {slugSkipped > 0 && (
                                    <p className="text-xs text-amber-600">⊘ {slugSkipped.toLocaleString()} skipped — slug already exists (enable Overwrite to regenerate)</p>
                                  )}
                                  {noBankServices > 0 && (
                                    <p className="text-xs text-amber-600">⊘ {noBankServices} service{noBankServices !== 1 ? "s" : ""} skipped — variation bank not written yet</p>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {job.createdAt && <span>Created {formatDistanceToNow(new Date(job.createdAt))} ago</span>}
                      {job.completedAt && <span>Completed {formatDistanceToNow(new Date(job.completedAt))} ago</span>}
                    </div>

                    {/* Error log toggle */}
                    {job.failedPages > 0 && job.errorLog?.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-destructive hover:underline"
                          onClick={() => toggleErrors(job.id)}
                        >
                          {expandedErrors.has(job.id) ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                          {expandedErrors.has(job.id) ? "Hide" : "Show"} {job.errorLog.length} error{job.errorLog.length !== 1 ? "s" : ""}
                        </button>
                        {expandedErrors.has(job.id) && (
                          <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                            {job.errorLog.map((err: any, i: number) => (
                              <div key={i} className="text-xs bg-red-50 border border-red-100 rounded px-2 py-1.5 text-red-700">
                                <span className="font-medium">{err.location || "—"} × {err.service || "—"}</span>
                                <span className="block text-red-500 mt-0.5 break-all">{err.error}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    {job.status === "running" && (
                      <Button variant="outline" size="sm" onClick={() => cancel.mutate(job.id)} data-testid={`button-cancel-${job.id}`}>
                        <Square className="size-3 mr-1" />Cancel
                      </Button>
                    )}
                    {isDeletable(job.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                        onClick={() => deleteJob.mutate(job.id)}
                        disabled={deleteJob.isPending}
                        data-testid={`button-delete-job-${job.id}`}
                      >
                        <Trash2 className="size-3.5 mr-1" />Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) { setForm({ ...emptyForm }); setLocFilter(""); setLocTypeFilter("state"); setTopCitiesLimit(null); setCityTierFilter(null); didAutoSelectServices.current = false; didAutoSelectLocations.current = false; } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Generation Job</DialogTitle></DialogHeader>
          <div className="space-y-4">

            {/* Account */}
            <div className="space-y-1.5">
              <Label>Account</Label>
              {accounts.length === 1 ? (
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/40 text-sm">
                  <CheckCircle className="size-3.5 text-emerald-500 shrink-0" />
                  <span>{accounts[0].name}</span>
                </div>
              ) : (
                <Select value={form.accountId} onValueChange={v => { didAutoSelectServices.current = false; didAutoSelectLocations.current = false; setForm({ ...emptyForm, accountId: v }); }}>
                  <SelectTrigger data-testid="select-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Website */}
            <div className="space-y-1.5">
              <Label>Website</Label>
              {accountWebsites.length === 1 && form.websiteId ? (
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/40 text-sm">
                  <CheckCircle className="size-3.5 text-emerald-500 shrink-0" />
                  <span>{accountWebsites[0].domain}</span>
                </div>
              ) : (
                <Select value={form.websiteId} onValueChange={v => setForm(p => ({ ...p, websiteId: v }))} disabled={!selectedAccountId}>
                  <SelectTrigger data-testid="select-website"><SelectValue placeholder="Select website" /></SelectTrigger>
                  <SelectContent>
                    {accountWebsites.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain ? `${w.settings.parentDomain}${w.settings.proxyPath || ''}` : w.domain}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Blueprint */}
            <div className="space-y-1.5">
              <Label>Blueprint</Label>
              {blueprints.length === 1 && form.blueprintId ? (
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/40 text-sm">
                  <CheckCircle className="size-3.5 text-emerald-500 shrink-0" />
                  <span>{blueprints[0].name}</span>
                  <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => setForm(p => ({ ...p, blueprintId: "" }))}>Change</button>
                </div>
              ) : (
                <Select value={form.blueprintId} onValueChange={v => setForm(p => ({ ...p, blueprintId: v }))} disabled={!selectedAccountId}>
                  <SelectTrigger data-testid="select-blueprint"><SelectValue placeholder={selectedAccountId ? "Select blueprint" : "Select account first"} /></SelectTrigger>
                  <SelectContent>
                    {blueprints.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Job Name */}
            <div className="space-y-1.5">
              <Label>Job Name <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input
                placeholder="e.g. SpotOn — Credit Card Processing Q1"
                data-testid="input-job-name"
                value={form.jobName}
                onChange={e => setForm(p => ({ ...p, jobName: e.target.value }))}
              />
            </div>

            {/* Services */}
            {selectedAccountId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>
                    Services{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      ({form.serviceIds.length} of {services.length} selected)
                    </span>
                  </Label>
                  <div className="flex gap-3">
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => selectAll("serviceIds", services.map((s: any) => s.id))}>All</button>
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => selectNone("serviceIds")}>None</button>
                  </div>
                </div>
                <div className="border rounded-md p-2 max-h-36 overflow-y-auto space-y-0.5">
                  {services.length === 0
                    ? <p className="text-xs text-muted-foreground px-1 py-2">Loading…</p>
                    : services.map((svc: any) => (
                      <label key={svc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-1 rounded" data-testid={`checkbox-service-${svc.id}`}>
                        <input type="checkbox" className="accent-primary" checked={form.serviceIds.includes(svc.id)} onChange={() => toggleSelection("serviceIds", svc.id)} />
                        {svc.name}
                      </label>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Locations */}
            {selectedAccountId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>
                    Locations{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      ({form.locationIds.length} of {locations.length} selected)
                    </span>
                  </Label>
                  <div className="flex gap-3">
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => selectAll("locationIds", filteredLocations.map((l: any) => l.id))}>All</button>
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => selectNone("locationIds")}>None</button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    className="h-8 text-sm flex-1"
                    placeholder="Search…"
                    value={locFilter}
                    onChange={e => setLocFilter(e.target.value)}
                  />
                  <Select value={locTypeFilter} onValueChange={(v: any) => { setLocTypeFilter(v); setTopCitiesLimit(null); setCityTierFilter(null); }}>
                    <SelectTrigger className="h-8 text-sm w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="state">States</SelectItem>
                      <SelectItem value="city">Cities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Top Cities quick select + Tier filters — only in Cities mode */}
                {locTypeFilter === "city" && (
                  <div className="flex items-center gap-2 flex-wrap" data-testid="div-jobs-top-cities-controls">
                    <Select
                      value={topCitiesLimit === null ? "" : String(topCitiesLimit)}
                      onValueChange={applyTopCitiesJobs}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-jobs-top-cities">
                        <SelectValue placeholder="Quick select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {[20, 50, 100, 250, 500, 750, 1000, 2500, 5000].map(n => (
                          <SelectItem key={n} value={String(n)}>Top {n.toLocaleString()}</SelectItem>
                        ))}
                        <SelectItem value="all">All Cities</SelectItem>
                      </SelectContent>
                    </Select>
                    {([
                      { tier: 1, label: "Tier 1 (500K+)" },
                      { tier: 2, label: "Tier 2 (100K–500K)" },
                      { tier: 3, label: "Tier 3 (<100K)" },
                    ] as { tier: number; label: string }[]).map(({ tier, label }) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => applyTierFilterJobs(tier)}
                        data-testid={`button-jobs-tier-${tier}`}
                        className={`h-8 px-3 rounded-md border text-xs font-medium transition-colors ${
                          cityTierFilter === tier
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Alphabet bar — only in Cities mode */}
                {locTypeFilter === "city" && (
                  <>
                    <div className="overflow-x-auto">
                      <div className="flex gap-0.5 min-w-max pb-0.5" data-testid="div-jobs-alphabet-bar">
                        {JOBS_ALPHABET.map(letter => {
                          const avail = cityLocAvailLetters.has(letter);
                          const fully = avail && isCityLocLetterFull(letter);
                          const partial = avail && isCityLocLetterPartial(letter);
                          return (
                            <button
                              key={letter}
                              type="button"
                              disabled={!avail}
                              onClick={() => toggleCityLocLetter(letter)}
                              data-testid={`button-jobletter-${letter}`}
                              className={`w-6 h-6 rounded text-xs font-mono font-semibold transition-colors ${
                                fully   ? "bg-primary text-primary-foreground" :
                                partial ? "bg-primary/25 text-primary border border-primary/40" :
                                avail   ? "bg-muted hover:bg-muted-foreground/20 text-foreground" :
                                          "text-muted-foreground/25 cursor-not-allowed"
                              }`}
                            >
                              {letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-xs font-medium" data-testid="text-jobs-city-count">
                      {form.locationIds.filter(id => locations.find((l: any) => l.id === id && l.type === "city")).length.toLocaleString()} cities selected
                    </p>
                  </>
                )}

                {/* Location list */}
                <div className="border rounded-md p-2 max-h-44 overflow-y-auto space-y-0.5">
                  {filteredLocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">No locations match.</p>
                  ) : locTypeFilter === "city" && !locFilter && topCitiesLimit === null && cityTierFilter === null ? (
                    /* Grouped alphabetical view for cities (no filter active) */
                    <>
                      {Object.entries(cityLocGroups)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([letter, group]) => (
                          <div key={letter}>
                            <div className="sticky top-0 bg-muted/90 backdrop-blur-sm px-1 py-0.5 text-xs font-bold text-muted-foreground tracking-widest rounded mb-0.5" data-testid={`header-jobletter-${letter}`}>
                              {letter}
                            </div>
                            {(group as any[]).map((loc: any) => (
                              <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-1 rounded" data-testid={`checkbox-location-${loc.id}`}>
                                <input type="checkbox" className="accent-primary" checked={selectedLocSet.has(loc.id)} onChange={() => toggleSelection("locationIds", loc.id)} />
                                <span className="flex-1">{loc.name}</span>
                                <span className="text-xs text-muted-foreground">{loc.stateCode}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                    </>
                  ) : (
                    /* Flat list for states/all, or when searching */
                    filteredLocations.map((loc: any) => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-1 rounded" data-testid={`checkbox-location-${loc.id}`}>
                        <input type="checkbox" className="accent-primary" checked={selectedLocSet.has(loc.id)} onChange={() => toggleSelection("locationIds", loc.id)} />
                        <span className="flex-1">{loc.name}</span>
                        <span className="text-xs text-muted-foreground">{loc.type === "state" ? "State" : loc.stateCode}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Page count */}
            {totalPages > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2 text-sm">
                <span className="font-semibold text-primary">{totalPages} pages</span>
                <span className="text-muted-foreground"> will be generated</span>
                <span className="text-muted-foreground text-xs block mt-0.5">{form.locationIds.length} locations × {form.serviceIds.length} services</span>
              </div>
            )}

            {!selectedAccountId && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Select an account above to load its locations and services.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 mt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createJob.mutate(form)}
              disabled={createJob.isPending || !form.accountId || !form.websiteId || !form.blueprintId || totalPages === 0}
              data-testid="button-start-job"
            >
              {createJob.isPending ? "Starting…" : totalPages > 0 ? `Start Job (${totalPages} pages)` : "Start Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
