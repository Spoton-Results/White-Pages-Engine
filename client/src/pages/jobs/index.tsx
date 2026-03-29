import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { AlertCircle, Play, Square, Plus, RefreshCw, Zap, CheckCircle, XCircle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function JobsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const websiteIdFilter = params.get("websiteId");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>({ locationIds: [], serviceIds: [], industryIds: [] });
  const [locFilter, setLocFilter] = useState("");
  const [locTypeFilter, setLocTypeFilter] = useState<"all" | "state" | "city">("all");

  const { data: jobs = [], isLoading } = useQuery({
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
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/blueprints`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "locations"],
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/locations`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "services"],
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/services`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const createJob = useMutation({
    mutationFn: (data: any) => api.post("/api/jobs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setShowCreate(false);
      setForm({ locationIds: [], serviceIds: [], industryIds: [] });
      setLocFilter("");
      setLocTypeFilter("all");
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

  const toggleSelection = (field: string, id: string) => {
    setForm((prev: any) => {
      const arr = prev[field] || [];
      return { ...prev, [field]: arr.includes(id) ? arr.filter((x: string) => x !== id) : [...arr, id] };
    });
  };

  const selectAll = (field: string, ids: string[]) => setForm((p: any) => ({ ...p, [field]: ids }));
  const selectNone = (field: string) => setForm((p: any) => ({ ...p, [field]: [] }));

  const filteredLocations = locations.filter((loc: any) => {
    const matchType = locTypeFilter === "all" || loc.type === locTypeFilter;
    const matchSearch = !locFilter || loc.name.toLowerCase().includes(locFilter.toLowerCase()) || (loc.stateCode || "").toLowerCase().includes(locFilter.toLowerCase());
    return matchType && matchSearch;
  });

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="size-4 text-emerald-500" />;
    if (status === "failed") return <XCircle className="size-4 text-destructive" />;
    if (status === "running") return <Play className="size-4 text-blue-500" />;
    return <Clock className="size-4 text-muted-foreground" />;
  };

  const totalPages = form.locationIds.length * form.serviceIds.length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Generation Jobs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Create and monitor AI page generation workflows.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/jobs"] })}>
              <RefreshCw className="size-4 mr-2" />Refresh
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)} data-testid="button-new-job">
              <Plus className="size-4" />New Job
            </Button>
          </div>
        </div>

        {!systemStatus?.claudeConfigured && (
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
            {[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
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

                    {(job.totalPages > 0) && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>{job.processedPages} / {job.totalPages} pages</span>
                          <span className="text-emerald-600">{job.passedPages} passed</span>
                          {job.failedPages > 0 && <span className="text-destructive">{job.failedPages} failed</span>}
                        </div>
                        <Progress value={job.totalPages > 0 ? (job.processedPages / job.totalPages) * 100 : 0} className="h-1.5" />
                      </div>
                    )}

                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {job.createdAt && <span>Created {formatDistanceToNow(new Date(job.createdAt))} ago</span>}
                      {job.completedAt && <span>Completed {formatDistanceToNow(new Date(job.completedAt))} ago</span>}
                    </div>
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

      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) { setLocFilter(""); setLocTypeFilter("all"); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Generation Job</DialogTitle></DialogHeader>
          <div className="space-y-4">

            {/* Account */}
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select onValueChange={v => setForm((_p: any) => ({ locationIds: [], serviceIds: [], industryIds: [], accountId: v }))}>
                <SelectTrigger data-testid="select-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Website */}
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Select onValueChange={v => setForm((p: any) => ({ ...p, websiteId: v }))} disabled={!selectedAccountId}>
                <SelectTrigger data-testid="select-website"><SelectValue placeholder="Select website" /></SelectTrigger>
                <SelectContent>
                  {websites.filter((w: any) => !selectedAccountId || w.accountId === selectedAccountId).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Blueprint */}
            <div className="space-y-1.5">
              <Label>Blueprint</Label>
              <Select onValueChange={v => setForm((p: any) => ({ ...p, blueprintId: v }))} disabled={!selectedAccountId}>
                <SelectTrigger data-testid="select-blueprint"><SelectValue placeholder="Select blueprint" /></SelectTrigger>
                <SelectContent>
                  {blueprints.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Job Name */}
            <div className="space-y-1.5">
              <Label>Job Name</Label>
              <Input
                placeholder="e.g. SpotOn — Credit Card Processing Q1"
                data-testid="input-job-name"
                onChange={e => setForm((p: any) => ({ ...p, jobName: e.target.value }))}
              />
            </div>

            {/* Services */}
            {selectedAccountId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Services <span className="text-muted-foreground font-normal">({form.serviceIds.length} of {services.length} selected)</span></Label>
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => selectAll("serviceIds", services.map((s: any) => s.id))}>All</button>
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => selectNone("serviceIds")}>None</button>
                  </div>
                </div>
                <div className="border rounded-md p-2 max-h-36 overflow-y-auto space-y-1">
                  {services.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">Loading services…</p>
                  ) : services.map((svc: any) => (
                    <label key={svc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded" data-testid={`checkbox-service-${svc.id}`}>
                      <input type="checkbox" checked={form.serviceIds?.includes(svc.id)} onChange={() => toggleSelection("serviceIds", svc.id)} />
                      {svc.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Locations */}
            {selectedAccountId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Locations <span className="text-muted-foreground font-normal">({form.locationIds.length} of {locations.length} selected)</span></Label>
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => selectAll("locationIds", filteredLocations.map((l: any) => l.id))}>All</button>
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => selectNone("locationIds")}>None</button>
                  </div>
                </div>

                {/* Filters */}
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-sm flex-1"
                    placeholder="Search locations…"
                    value={locFilter}
                    onChange={e => setLocFilter(e.target.value)}
                  />
                  <Select value={locTypeFilter} onValueChange={(v: any) => setLocTypeFilter(v)}>
                    <SelectTrigger className="h-7 text-sm w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="state">States</SelectItem>
                      <SelectItem value="city">Cities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                  {filteredLocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">No locations match your filter.</p>
                  ) : filteredLocations.map((loc: any) => (
                    <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded" data-testid={`checkbox-location-${loc.id}`}>
                      <input type="checkbox" checked={form.locationIds?.includes(loc.id)} onChange={() => toggleSelection("locationIds", loc.id)} />
                      <span className="flex-1">{loc.name}</span>
                      <span className="text-xs text-muted-foreground">{loc.type === "state" ? "State" : loc.stateCode}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Page count estimate */}
            {totalPages > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2 text-sm">
                <span className="font-medium text-primary">{totalPages} pages</span>
                <span className="text-muted-foreground"> will be generated ({form.locationIds.length} locations × {form.serviceIds.length} services)</span>
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
              disabled={createJob.isPending || !form.accountId || !form.websiteId || !form.blueprintId}
              data-testid="button-start-job"
            >
              {createJob.isPending ? "Starting…" : `Start Job${totalPages > 0 ? ` (${totalPages} pages)` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
