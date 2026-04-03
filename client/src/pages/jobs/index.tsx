import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
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
import { AlertCircle, Play, Square, Plus, RefreshCw, Zap, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
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
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

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

  const filteredLocations = locations.filter((loc: any) => {
    const matchType = locTypeFilter === "all" || loc.type === locTypeFilter;
    const matchSearch = !locFilter || loc.name.toLowerCase().includes(locFilter.toLowerCase()) || (loc.stateCode || "").toLowerCase().includes(locFilter.toLowerCase());
    return matchType && matchSearch;
  });

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
          <div className="flex gap-2">
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
        ) : (
          <div className="space-y-3">
            {jobs.map((job: any) => (
              <Card key={job.id} data-testid={`card-job-${job.id}`}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="mt-0.5">{statusIcon(job.status)}</div>
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

                    {job.totalPages > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>{job.processedPages} / {job.totalPages} pages</span>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-600">{job.passedPages} passed</span>
                            {job.failedPages > 0 && <span className="text-destructive">{job.failedPages} failed</span>}
                            {(() => { const skipped = job.processedPages - job.passedPages - (job.failedPages ?? 0); return skipped > 0 ? <span className="text-amber-500">{skipped} skipped</span> : null; })()}
                          </div>
                        </div>
                        <Progress value={(job.processedPages / job.totalPages) * 100} className="h-1.5" />
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

                  {job.status === "running" && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => cancel.mutate(job.id)}>
                      <Square className="size-3 mr-1" />Cancel
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) { setForm({ ...emptyForm }); setLocFilter(""); setLocTypeFilter("state"); didAutoSelectServices.current = false; didAutoSelectLocations.current = false; } }}>
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
                    {accountWebsites.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>)}
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
                  <Select value={locTypeFilter} onValueChange={(v: any) => setLocTypeFilter(v)}>
                    <SelectTrigger className="h-8 text-sm w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="state">States</SelectItem>
                      <SelectItem value="city">Cities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border rounded-md p-2 max-h-44 overflow-y-auto space-y-0.5">
                  {filteredLocations.length === 0
                    ? <p className="text-xs text-muted-foreground px-1 py-2">No locations match.</p>
                    : filteredLocations.map((loc: any) => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-1 rounded" data-testid={`checkbox-location-${loc.id}`}>
                        <input type="checkbox" className="accent-primary" checked={form.locationIds.includes(loc.id)} onChange={() => toggleSelection("locationIds", loc.id)} />
                        <span className="flex-1">{loc.name}</span>
                        <span className="text-xs text-muted-foreground">{loc.type === "state" ? "State" : loc.stateCode}</span>
                      </label>
                    ))
                  }
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
